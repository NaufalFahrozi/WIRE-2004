"""Find where a beat's sample came from, and rebuild it from the source record.

    .venv/Scripts/python tools/match_sample.py "Through the Fire.mp3"

The beat was made by speeding a record up, cutting it into chops and
re-triggering each chop on the grid. This works out how much the record was
sped up and exactly which piece of it sits under each chop of the hook, then
cuts those pieces out of the source record itself. The result is the sample
with nothing rapped or played over it: the chops as they sat on the pads.

It works in two passes:
  1. Coarse. Compare pitch content. On a log-frequency axis a change of
     playback speed is a plain shift, so every speed can be tried cheaply.
  2. Fine. The source recording is literally inside the finished mix, so the
     two waveforms correlate. That places each chop to a fraction of a
     millisecond and shows where one chop ends and the next begins.

Needs the stems and kit.json from separate.py and build_kit.py. Writes
sample_map.json and source_*.wav into public/kit/; run build_kit.py again
afterwards to put them on the pads.
"""

import json
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, correlate, csd, fftconvolve, resample_poly, sosfiltfilt, stft, welch

KIT = Path(__file__).resolve().parent.parent / "public" / "kit"
BARS = 8
CHOP_BEATS = 2

# ---- coarse pass: pitch content -------------------------------------------

SR = 22050
N_FFT = 4096
HOP = 1024
BINS_PER_OCT = 36
N_BINS = BINS_PER_OCT * 5


def pitch_map(audio, sr):
    """Loudness per pitch over time, 36 steps per octave from 110 Hz up."""
    ratio = Fraction(SR, sr).limit_denominator(1000)
    mono = resample_poly(audio.mean(1), ratio.numerator, ratio.denominator)
    freqs, _, spec = stft(mono, SR, nperseg=N_FFT, noverlap=N_FFT - HOP, padded=False, boundary=None)
    mag = np.abs(spec)
    pos = 110.0 * 2 ** (np.arange(N_BINS) / BINS_PER_OCT) / (freqs[1] - freqs[0])
    lo = np.floor(pos).astype(int)
    frac = (pos - lo)[:, None]
    return np.log1p(40 * (mag[lo] * (1 - frac) + mag[lo + 1] * frac))


def unit(x):
    x = x - x.mean(0, keepdims=True)
    return x / (np.linalg.norm(x, axis=0, keepdims=True) + 1e-9)


def speed_up(src_map, rate):
    """The source's pitch map as it would look played `rate` times faster:
    everything moves up in pitch and passes by sooner."""
    rows = np.arange(N_BINS) - BINS_PER_OCT * np.log2(rate)
    lo = np.floor(rows).astype(int)
    frac = (rows - lo)[:, None]
    ok = (lo >= 0) & (lo + 1 < N_BINS)
    moved = np.zeros_like(src_map)
    moved[ok] = src_map[lo[ok]] * (1 - frac[ok]) + src_map[lo[ok] + 1] * frac[ok]
    cols = np.arange(0, src_map.shape[1] - 1, rate)
    c0 = np.floor(cols).astype(int)
    cf = cols - c0
    return unit(moved[:, c0] * (1 - cf) + moved[:, c0 + 1] * cf)


def slide(piece, whole):
    """Similarity of `piece` at every position in `whole` (1.0 = identical)."""
    total = np.zeros(whole.shape[1] - piece.shape[1] + 1)
    for b in range(N_BINS):
        total += fftconvolve(whole[b], piece[b, ::-1], mode="valid")
    return total / piece.shape[1]


def coarse(hook_audio, sr, source, src_sr):
    hook = unit(pitch_map(hook_audio, sr))
    per_bar = hook.shape[1] / BARS
    pieces = [hook[:, int(round(i * per_bar)) : int(round((i + 1) * per_bar))] for i in range(BARS)]
    src_map = pitch_map(source, src_sr)

    # Try every speed; keep the one where the bars of the hook, each allowed
    # to land anywhere in the source, fit best overall.
    best = (-1, 1.0)
    for step, around in [(0.004, None), (0.0005, 0.004)]:
        rates = np.arange(1.0, 1.9, step) if around is None else np.arange(best[1] - around, best[1] + around, step)
        for rate in rates:
            sped = speed_up(src_map, rate)
            if sped.shape[1] <= pieces[0].shape[1]:
                continue
            score = float(np.mean([slide(p, sped).max() for p in pieces]))
            if score > best[0]:
                best = (score, rate)
    score, rate = best
    sped = speed_up(src_map, rate)
    frame = HOP / SR
    spots = [int(slide(p, sped).argmax()) * frame * rate for p in pieces]
    return rate, score, spots, int(slide(hook, sped).argmax()) * frame * rate


# ---- fine pass: the waveform itself ---------------------------------------

DECIMATE = 4


def band(audio, sr):
    """Mono, 150-1500 Hz, at a quarter of the sample rate: the range where the
    sample is strongest against the drums and bass laid over it."""
    sos = butter(4, [150, 1500], btype="band", fs=sr, output="sos")
    return resample_poly(sosfiltfilt(sos, audio.mean(1)), 1, DECIMATE)


def sped_source(source, src_sr, sr, rate, src_from, seconds, pad):
    """A stretch of the source, resampled to play `rate` times faster."""
    ratio = Fraction(src_sr / (rate * sr)).limit_denominator(8000)
    a = int(round((src_from - pad * rate) * src_sr))
    seg = source[max(0, a) : a + int(round((seconds + 2 * pad) * rate * src_sr))]
    return resample_poly(seg, ratio.numerator, ratio.denominator, axis=0)


def best_lag(piece, whole, pad, fs):
    """Where `piece` sits in `whole`, as a lag in seconds from the expected
    spot, plus how far the peak stands out and whether it is upside down."""
    c = correlate(whole, piece, mode="valid")
    energy = np.sqrt(np.convolve(whole * whole, np.ones(len(piece)), mode="valid")) * np.linalg.norm(piece) + 1e-12
    c = c / energy
    k = int(np.abs(c).argmax())
    stand_out = (abs(c[k]) - np.abs(c).mean()) / np.abs(c).std()
    return k / fs - pad, float(stand_out), float(c[k])


def find_drift(target, sped, pad, fs):
    """If the speed is slightly off, the lag creeps steadily. Measure the creep
    inside runs of neighbouring windows that agree with each other."""
    win, hop = 2048, 256
    rows = []
    for w0 in range(0, len(target) - win, hop):
        whole = sped[w0 : w0 + win + int(2 * pad * fs)]
        if len(whole) < win + 16:
            break
        lag, stand_out, _ = best_lag(target[w0 : w0 + win], whole, pad, fs)
        rows.append((w0 / fs, lag, stand_out))
    runs, drifts = [], []
    for t, lag, stand_out in rows:
        if stand_out < 5.5:
            continue
        if runs and abs(lag - runs[-1][-1][1]) < 0.001:
            runs[-1].append((t, lag))
        else:
            runs.append([(t, lag)])
    for run in runs:
        if len(run) >= 8:
            drifts.append((run[-1][1] - run[0][1]) / (run[-1][0] - run[0][0]))
    return float(np.median(drifts)) if drifts else 0.0


def main(src_path):
    kit = json.loads((KIT / "kit.json").read_text())
    beat = 60 / kit["bpm"]
    bar = 4 * beat
    start = kit["start"]
    span = BARS * bar

    full, sr = sf.read(KIT / "full.flac", dtype="float32", always_2d=True)
    other, _ = sf.read(KIT / "other.flac", dtype="float32", always_2d=True)
    vocals, _ = sf.read(KIT / "vocals.flac", dtype="float32", always_2d=True)
    source, src_sr = sf.read(src_path, dtype="float32", always_2d=True)
    a, b = int(start * sr), int((start + span) * sr)

    rate, fit, spots, src0 = coarse((other + vocals)[a:b], sr, source, src_sr)
    steps = np.diff(spots)
    if not np.all(np.abs(steps - bar * rate) < 0.3):
        print("warning: the bars of the hook do not follow on from each other in the source;")
        print("         the fine pass assumes they do and may be wrong")
    print(f"coarse: sped up {rate:.4f}x, hook starts {src0 // 60:.0f}:{src0 % 60:05.2f} into the source, fit {fit:.2f}")

    fs = sr // DECIMATE
    target = band(full[a:b], sr)
    pad = 0.4
    for _ in range(3):
        sped = band(sped_source(source, src_sr, sr, rate, src0, span, pad), sr)
        drift = find_drift(target, sped, pad, fs)
        rate *= 1 + drift
        if abs(drift) < 2e-5:
            break
    semis = 12 * np.log2(rate)
    print(f"fine:   sped up {rate:.4f}x ({semis:+.2f} semitones)")

    # Place every chop on its own.
    sped = band(sped_source(source, src_sr, sr, rate, src0, span, pad), sr)
    n_chops = BARS * 4 // CHOP_BEATS
    chop_len = CHOP_BEATS * beat
    chops = []
    for i in range(n_chops):
        t = i * chop_len
        w0, n = int(round(t * fs)), int(round(chop_len * fs))
        lag, stand_out, corr = best_lag(target[w0 : w0 + n], sped[w0 : w0 + n + int(2 * pad * fs)], pad, fs)
        chops.append({"n": i + 1, "t": t, "lag": lag, "stand_out": stand_out, "corr": corr})
    # A chop that did not match clearly takes its place from its neighbours.
    sure = [c for c in chops if c["stand_out"] >= 6]
    for c in chops:
        if c["stand_out"] < 6 and sure:
            c["lag"] = float(np.interp(c["t"], [s["t"] for s in sure], [s["lag"] for s in sure]))
            c["guessed"] = True
        c["source"] = src0 + (c["t"] + c["lag"]) * rate
    flipped = float(np.median([c["corr"] for c in sure])) < 0 if sure else False

    # Cut the chops out of the source, sped up.
    n_out = int(round(chop_len * sr))
    lead = 0.003
    lead_n = int(round(lead * sr))

    def cut_all():
        out = []
        for c in chops:
            seg = sped_source(source, src_sr, sr, rate, c["source"] - lead * rate, chop_len + 0.05, 0.05)
            seg = seg[int(round(0.05 * sr)) :][:n_out]
            if seg.shape[1] == 1:
                seg = np.repeat(seg, 2, axis=1)
            out.append(seg.astype(np.float64))
        return out

    refs = [full[a + i * n_out - lead_n : a + (i + 1) * n_out - lead_n].mean(1) for i in range(n_chops)]
    mid_band = butter(4, [300, 2500], btype="band", fs=sr, output="sos")
    # The first placing was done at a quarter of the sample rate. Tighten each
    # chop to the nearest sample, twice over, and cut again.
    for _ in range(2):
        for c, seg, ref in zip(chops, cut_all(), refs):
            x = correlate(sosfiltfilt(mid_band, ref), sosfiltfilt(mid_band, seg.mean(1)), mode="same")
            centre = len(x) // 2
            k = int(np.abs(x[centre - 40 : centre + 41]).argmax()) - 40
            c["source"] -= k / sr * rate
            c["lag"] -= k / sr
    raw = cut_all()

    # How was it sampled? Samplers of the time were often fed one channel.
    # Ask which blend of the source's left and right is in the record.
    lr = np.concatenate([sosfiltfilt(mid_band, seg, axis=0) for seg in raw])
    want = np.concatenate([sosfiltfilt(mid_band, r) for r in refs])
    weights, *_ = np.linalg.lstsq(lr, want, rcond=None)
    share = np.abs(weights) / np.abs(weights).sum()
    if share.min() < 0.25:
        channel = int(share.argmax())
        blend = np.eye(2)[channel]
        how = f"mono, from the {'left' if channel == 0 else 'right'} channel only"
    else:
        blend = np.sign(weights) * share
        how = f"mono, left {share[0]:.0%} and right {share[1]:.0%}"
    mono = [seg @ blend for seg in raw]

    # How loud, and with what tone? Compare the sampled channel with the
    # record one octave at a time, each chop nudged into exact alignment first.
    pxy = pxx = 0
    for seg, ref in zip(mono, refs):
        c = correlate(sosfiltfilt(mid_band, ref), sosfiltfilt(mid_band, seg), mode="same")
        mid = len(c) // 2
        k = int(np.abs(c[mid - 40 : mid + 41]).argmax()) - 40
        seg = np.roll(seg, k)
        freqs, cross = csd(seg, ref, sr, nperseg=2048)
        pxy = pxy + cross
        pxx = pxx + welch(seg, sr, nperseg=2048)[1]

    def in_band(lo, hi):
        keep = (freqs >= lo) & (freqs < hi)
        return complex(pxy[keep].sum() / pxx[keep].sum())

    core = in_band(1000, 4000)
    gain = abs(core) * (-1 if core.real < 0 else 1)
    flipped = gain < 0
    top = 20 * np.log10(abs(in_band(4000, 8000)) / abs(core))
    air = 20 * np.log10(abs(in_band(8000, 16000)) / abs(core))
    print(f"sampled {how}{', polarity flipped' if flipped else ''}; sits at {abs(gain):.2f}x in the mix")
    print(f"tone:   {top:+.1f} dB at 4-8 kHz, {air:+.1f} dB above 8 kHz")
    cutoff = None
    if top < -1.5 and air < -9:
        # The highs are rolled off the way a sampler's filter does it. A
        # third-order low-pass set to give the measured loss at 5.7 kHz.
        cutoff = float(np.clip(5657 / (10 ** (-top / 10) - 1) ** (1 / 6), 2500, 12000))
        lowpass = butter(3, cutoff, btype="low", fs=sr, output="sos")
        mono = [sosfiltfilt(lowpass, seg) for seg in mono]
        print(f"        matched with a low-pass at {cutoff:.0f} Hz")
    cuts = [np.repeat(seg[:, None], 2, axis=1).astype(np.float32) for seg in mono]
    match = float(np.mean([abs(c["corr"]) for c in sure])) if sure else 0.0
    print(f"check:  {len(sure)} of {n_chops} chops found in the record's waveform")

    fade = int(0.002 * sr)
    for seg in cuts:
        seg *= gain
        seg[:fade] *= np.linspace(0, 1, fade)[:, None]
        seg[-fade:] *= np.linspace(1, 0, fade)[:, None]
    peak = max(float(np.abs(seg).max()) for seg in cuts)
    scale = min(1.0, 0.98 / peak)
    for i, seg in enumerate(cuts):
        sf.write(KIT / f"source_chop{i + 1:02d}.wav", seg * scale, sr, subtype="PCM_16")
    per_bar = 4 // CHOP_BEATS
    for i in range(BARS):
        sf.write(KIT / f"source_phrase{i + 1}.wav", np.concatenate(cuts[i * per_bar : (i + 1) * per_bar]) * scale, sr, subtype="PCM_16")
    sf.write(KIT / "source_loop.wav", np.concatenate(cuts) * scale, sr, subtype="PCM_16")

    print("chop  beat   source      shift    match")
    for c in chops:
        s = c["source"]
        print(f"  {c['n']:2d}   {c['t'] / beat:4.0f}   {s // 60:.0f}:{s % 60:06.3f}  {c['lag'] * 1000:+7.1f} ms  "
              f"{'guessed from neighbours' if c.get('guessed') else format(c['stand_out'], '.0f') + ' sd'}")

    (KIT / "sample_map.json").write_text(json.dumps({
        "title": "Through the Fire",
        "artist": "Chaka Khan",
        "rate": round(float(rate), 5),
        "semitones": round(float(semis), 2),
        "correlation": round(match, 3),
        "flipped": bool(flipped),
        "sampled": how,
        "gain": round(abs(float(gain)), 3),
        "lowpass_hz": cutoff and round(cutoff),
        "chop_beats": CHOP_BEATS,
        "level": round(scale, 4),
        "chops": [{"n": c["n"], "source": round(float(c["source"]), 4), "shift_ms": round(c["lag"] * 1000, 1),
                   "guessed": bool(c.get("guessed"))} for c in chops],
    }, indent=2))
    print(f"wrote {n_chops} chops, {BARS} phrases, source_loop.wav, sample_map.json")


if __name__ == "__main__":
    main(sys.argv[1])
