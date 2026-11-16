"""Find where a beat's sample came from, and rebuild it from the source record.

    .venv/Scripts/python tools/match_sample.py "Through The Fire.mp3"

The beat was made by speeding a record up and looping part of it. This works
out how much it was sped up and which stretch of the source sits under each
bar of the hook, then cuts those stretches out of the source, sped up to
match. The result is the sample with nothing rapped or played over it.

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
from scipy.signal import fftconvolve, resample_poly, stft

KIT = Path(__file__).resolve().parent.parent / "public" / "kit"
SR = 22050
N_FFT = 4096
HOP = 1024
BINS_PER_OCT = 36
F_MIN = 110.0
OCTAVES = 5
N_BINS = BINS_PER_OCT * OCTAVES


def to_mono(audio, sr):
    mono = audio.mean(1)
    ratio = Fraction(SR, sr).limit_denominator(1000)
    return resample_poly(mono, ratio.numerator, ratio.denominator).astype(np.float32)


def pitch_map(mono):
    """Loudness per pitch over time, on a log-frequency axis (36 steps per
    octave). On this axis a change of playback speed is a plain shift."""
    freqs, _, spec = stft(mono, SR, nperseg=N_FFT, noverlap=N_FFT - HOP, padded=False, boundary=None)
    mag = np.abs(spec)
    centres = F_MIN * 2 ** (np.arange(N_BINS) / BINS_PER_OCT)
    pos = centres / (freqs[1] - freqs[0])
    lo = np.floor(pos).astype(int)
    frac = (pos - lo)[:, None]
    out = np.log1p(40 * (mag[lo] * (1 - frac) + mag[lo + 1] * frac))
    return out


def unit(x):
    x = x - x.mean(0, keepdims=True)
    return x / (np.linalg.norm(x, axis=0, keepdims=True) + 1e-9)


def speed_up(src_map, rate):
    """What the source's pitch map looks like played `rate` times faster:
    everything moves up in pitch and passes by sooner."""
    shift = BINS_PER_OCT * np.log2(rate)
    rows = np.arange(N_BINS) - shift
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
    """Similarity of `piece` against every position in `whole` (1.0 = identical)."""
    total = np.zeros(whole.shape[1] - piece.shape[1] + 1)
    for b in range(N_BINS):
        total += fftconvolve(whole[b], piece[b, ::-1], mode="valid")
    return total / piece.shape[1]


def main(src_path):
    kit = json.loads((KIT / "kit.json").read_text())
    bar = 240 / kit["bpm"]
    bars = 8
    start = kit["start"]

    other, sr = sf.read(KIT / "other.flac", dtype="float32", always_2d=True)
    vocals, _ = sf.read(KIT / "vocals.flac", dtype="float32", always_2d=True)
    a, b = int(start * sr), int((start + bars * bar) * sr)
    hook = unit(pitch_map(to_mono((other + vocals)[a:b], sr)))
    per_bar = hook.shape[1] / bars
    pieces = [hook[:, int(round(i * per_bar)) : int(round((i + 1) * per_bar))] for i in range(bars)]

    source, src_sr = sf.read(src_path, dtype="float32", always_2d=True)
    src_map = pitch_map(to_mono(source, src_sr))

    # How much faster? Try every speed and keep the one where the bars of the
    # hook, each allowed to land anywhere in the source, fit best overall.
    best = (-1, 1.0)
    for rate in np.arange(1.0, 1.9, 0.004):
        sped = speed_up(src_map, rate)
        if sped.shape[1] <= pieces[0].shape[1]:
            continue
        score = float(np.mean([slide(p, sped).max() for p in pieces]))
        if score > best[0]:
            best = (score, rate)
    for rate in np.arange(best[1] - 0.004, best[1] + 0.004, 0.0005):
        sped = speed_up(src_map, rate)
        score = float(np.mean([slide(p, sped).max() for p in pieces]))
        if score > best[0]:
            best = (score, rate)
    score, rate = best
    semis = 12 * np.log2(rate)
    print(f"sped up {rate:.4f}x ({semis:+.2f} semitones), fit {score:.2f}")

    # Where does each bar of the hook come from?
    sped = speed_up(src_map, rate)
    frame = HOP / SR
    spots = []
    for i, p in enumerate(pieces):
        sim = slide(p, sped)
        k = int(sim.argmax())
        spots.append({"bar": i + 1, "source": round(k * frame * rate, 3), "fit": round(float(sim[k]), 3)})
    # If the hook is one unbroken stretch of the source, say so; if it was
    # re-chopped, the bars will not follow on from each other.
    steps = np.diff([s["source"] for s in spots])
    straight = bool(np.all(np.abs(steps - bar * rate) < 0.25))
    for s in spots:
        print(f"  bar {s['bar']}: source {int(s['source'] // 60)}:{s['source'] % 60:05.2f}  fit {s['fit']:.2f}")
    print("the hook is", "one unbroken stretch of the source" if straight else "re-chopped from several places")
    if straight:
        # One straight run: place every bar from the best-fitting whole.
        sim = slide(hook, sped)
        first = int(sim.argmax()) * frame * rate
        for i, s in enumerate(spots):
            s["source"] = round(first + i * bar * rate, 3)

    # Cut the source, sped up to the beat's tempo.
    ratio = Fraction(src_sr / (rate * sr)).limit_denominator(2000)
    out_len = int(round(bar * sr))
    cuts = []
    for s in spots:
        a = int(round((s["source"] - 0.003 * rate) * src_sr))
        seg = source[max(0, a) : a + int(round(bar * rate * src_sr)) + 64]
        seg = resample_poly(seg, ratio.numerator, ratio.denominator, axis=0)[:out_len]
        if len(seg) < out_len:
            seg = np.pad(seg, ((0, out_len - len(seg)), (0, 0)))
        if seg.shape[1] == 1:
            seg = np.repeat(seg, 2, axis=1)
        cuts.append(seg.astype(np.float32))

    fade = int(0.004 * sr)
    loop = np.concatenate(cuts)
    if not straight:
        # Smooth the joins between chops.
        for i in range(1, bars):
            j = i * out_len
            loop[j - fade : j] *= np.linspace(1, 0.2, fade)[:, None]
            loop[j : j + fade] *= np.linspace(0.2, 1, fade)[:, None]
    loop[:fade] *= np.linspace(0, 1, fade)[:, None]
    loop[-fade:] *= np.linspace(1, 0, fade)[:, None]
    sf.write(KIT / "source_loop.wav", np.clip(loop, -1, 1), sr, subtype="PCM_16")
    for i, seg in enumerate(cuts):
        seg = seg.copy()
        seg[:fade] *= np.linspace(0, 1, fade)[:, None]
        seg[-fade * 5 :] *= np.linspace(1, 0, fade * 5)[:, None]
        sf.write(KIT / f"source_phrase{i + 1}.wav", np.clip(seg, -1, 1), sr, subtype="PCM_16")

    (KIT / "sample_map.json").write_text(
        json.dumps({"rate": round(float(rate), 4), "semitones": round(float(semis), 2), "fit": round(score, 3),
                    "straight": straight, "bars": spots}, indent=2)
    )
    print("wrote source_loop.wav, source_phrase1-8.wav, sample_map.json")


if __name__ == "__main__":
    main(sys.argv[1])
