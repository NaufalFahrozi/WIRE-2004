"""Build the playable kit from the stems made by tools/separate.py.

    .venv/Scripts/python tools/build_kit.py

Finds the tempo and the bar lines, then lifts the cleanest kick, snare and
hi-hat hits out of the drum stem. Writes one-shots and kit.json into
public/kit/, which the web app picks up on its own.
"""

import json
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import stft

KIT = Path(__file__).resolve().parent.parent / "public" / "kit"
HOP = 256
WIN = 1024


def onset_envelope(mono, sr, lo=None, hi=None):
    freqs, _, spec = stft(mono, sr, nperseg=WIN, noverlap=WIN - HOP, padded=False, boundary=None)
    mag = np.abs(spec)
    if lo is not None or hi is not None:
        keep = (freqs >= (lo or 0)) & (freqs < (hi or 1e9))
        mag = mag[keep]
    flux = np.maximum(0, np.diff(np.log1p(60 * mag), axis=1)).sum(0)
    return np.concatenate([[0], flux]), freqs, np.abs(spec)


def find_tempo(env, sr):
    """Tempo and beat phase by fitting a comb of beats to the onset envelope."""
    fps = sr / HOP
    idx = np.arange(len(env))

    def score(bpm, offset):
        beat = 60 / bpm * fps
        pos = np.arange(offset * fps, len(env) - 1, beat)
        return np.interp(pos, idx, env).mean()

    # Coarse pass over tempo, then a fine pass, since a small tempo error
    # drifts badly over a whole song.
    best = (0, 0, 0)
    for bpm in np.arange(70, 140, 0.25):
        for offset in np.arange(0, 60 / bpm, 0.012):
            sc = score(bpm, offset)
            if sc > best[0]:
                best = (sc, bpm, offset)
    _, bpm0, off0 = best
    best = (0, bpm0, off0)
    for bpm in np.arange(bpm0 - 0.4, bpm0 + 0.4, 0.004):
        for offset in np.arange(off0 - 0.05, off0 + 0.05, 0.004):
            sc = score(bpm, max(0, offset))
            if sc > best[0]:
                best = (sc, bpm, max(0, offset))
    return best[1], best[2]


def find_downbeat(low_env, sr, bpm, first):
    """Which of the four beats is the 'one': the beat the kick favours."""
    fps = sr / HOP
    beat = 60 / bpm * fps
    pos = np.arange(first * fps, len(low_env) - 1, beat)
    vals = np.interp(pos, np.arange(len(low_env)), low_env)
    sums = [vals[k::4].sum() + vals[(k + 2) % 4 :: 4].sum() * 0.5 - vals[(k + 1) % 4 :: 4].sum() for k in range(4)]
    return int(np.argmax(sums))


def pick_onsets(env, sr):
    fps = sr / HOP
    thresh = np.median(env) + 1.2 * env.std()
    gap = int(0.06 * fps)
    out = []
    for i in range(3, len(env) - 3):
        if env[i] > thresh and env[i] == env[max(0, i - 4) : i + 5].max():
            if not out or i - out[-1] >= gap:
                out.append(i)
    return np.array(out)


def describe(onsets, freqs, mag, sr):
    """Band balance of each hit over its first 70 ms."""
    span = int(0.07 * sr / HOP)
    low = freqs < 130
    mid = (freqs >= 180) & (freqs < 3500)
    high = freqs >= 6000
    rows = []
    for k, f in enumerate(onsets):
        seg = mag[:, f : f + span] ** 2
        total = seg.sum() + 1e-12
        nxt = onsets[k + 1] if k + 1 < len(onsets) else f + 400
        prv = onsets[k - 1] if k else f - 400
        rows.append(
            dict(
                frame=int(f),
                loud=float(total),
                low=float(seg[low].sum() / total),
                mid=float(seg[mid].sum() / total),
                high=float(seg[high].sum() / total),
                after=float((nxt - f) * HOP / sr),
                before=float((f - prv) * HOP / sr),
            )
        )
    return rows


def best_hit(rows, want, purity):
    """The cleanest example of a drum: typical loudness, alone in time, pure in tone."""
    pool = [r for r in rows if want(r)]
    if not pool:
        return None
    louds = np.array([r["loud"] for r in pool])
    floor = np.percentile(louds, 55)
    pool = [r for r in pool if r["loud"] >= floor] or pool
    return max(pool, key=lambda r: min(r["after"], 0.45) * 2 + min(r["before"], 0.3) + purity(r))


def cut(drums, sr, row, length):
    start = max(0, row["frame"] * HOP - int(0.004 * sr))
    # Slide to just before the transient really starts.
    look = np.abs(drums[start : start + int(0.03 * sr)]).max(1)
    if look.size and look.max() > 0:
        start += max(0, int(np.argmax(look > look.max() * 0.3)) - int(0.0015 * sr))
    n = int(min(length, max(0.07, row["after"] - 0.006)) * sr)
    hit = drums[start : start + n].copy()
    fade = min(len(hit), int(0.025 * sr))
    hit[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    hit[: int(0.001 * sr)] *= np.linspace(0, 1, int(0.001 * sr))[:, None]
    return hit * (0.9 / max(1e-6, np.abs(hit).max()))


def power(path, sr_expected, lo, hi):
    """Energy over time of one stem inside a frequency band."""
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    assert sr == sr_expected
    freqs, times, spec = stft(audio.mean(1), sr, nperseg=2048, noverlap=1024, padded=False, boundary=None)
    keep = (freqs >= lo) & (freqs < hi)
    return times, (np.abs(spec[keep]) ** 2).sum(0)


def find_hook(sr, bpm, first, duration, bars=8):
    """The stretch of the song where the sample plays with the least rapping
    over it. A rapped verse puts a lot of energy where a speaking voice sits
    (85-260 Hz); the sped-up sample vocal lives well above that."""
    bar = 240 / bpm
    count = int((duration - first) / bar)
    t, rap = power(KIT / "vocals.flac", sr, 85, 260)
    _, voice = power(KIT / "vocals.flac", sr, 450, 4000)
    _, drums = power(KIT / "drums.flac", sr, 0, 1e9)

    def per_bar(x):
        v = np.array([x[(t >= first + b * bar) & (t < first + (b + 1) * bar)].sum() for b in range(count)])
        return v / np.median(v[v > 0])

    rap, voice, drums = per_bar(rap), per_bar(voice), per_bar(drums)
    best = None
    for b in range(count - bars + 1):
        w = slice(b, b + bars)
        # The sample vocal has to be there, and the drums have to be playing.
        if voice[w].min() < 0.25 or drums[w].min() < 0.6:
            continue
        if best is None or rap[w].sum() < best[0]:
            best = (rap[w].sum(), b)
    if best is None:
        raise SystemExit("no clean stretch found")
    return best[1]


def loop_cut(path, sr, start, seconds, fade_out=0.004):
    """Cut a stretch of a stem, starting a hair early so the first hit is whole."""
    audio, _ = sf.read(path, dtype="float32", always_2d=True)
    a = int(round((start - 0.003) * sr))
    out = audio[a : a + int(round(seconds * sr))].copy()
    n_in, n_out = int(0.002 * sr), int(fade_out * sr)
    out[:n_in] *= np.linspace(0, 1, n_in)[:, None]
    out[-n_out:] *= np.linspace(1, 0, n_out)[:, None]
    return out


def main():
    drums, sr = sf.read(KIT / "drums.flac", dtype="float32", always_2d=True)
    mono = drums.mean(1)
    env, freqs, mag = onset_envelope(mono, sr)
    low_env, _, _ = onset_envelope(mono, sr, hi=130)

    bpm, first = find_tempo(env, sr)
    beat = 60 / bpm
    first += find_downbeat(low_env, sr, bpm, first) * beat
    while first - 4 * beat >= 0:
        first -= 4 * beat

    onsets = pick_onsets(env, sr)
    rows = describe(onsets, freqs, mag, sr)
    print(f"tempo {bpm:.3f} bpm, first bar at {first:.3f}s, {len(rows)} drum hits found")

    wanted = [
        ("KICK", "kick.wav", 0.4, lambda r: r["low"] > 0.45 and r["high"] < 0.1, lambda r: r["low"]),
        ("SNARE", "snare.wav", 0.34, lambda r: r["low"] < 0.25 and r["mid"] > 0.4, lambda r: r["mid"]),
        ("HAT", "hat.wav", 0.14, lambda r: r["high"] > 0.45 and r["low"] < 0.08, lambda r: r["high"]),
    ]
    drum_list = []
    used = set()
    for name, file, length, want, purity in wanted:
        row = best_hit(rows, want, purity)
        n = sum(1 for r in rows if want(r))
        if row is None:
            print(f"  {name}: none found")
            continue
        used.add(row["frame"])
        sf.write(KIT / file, cut(drums, sr, row, length), sr, subtype="PCM_16")
        drum_list.append({"name": name, "file": file})
        print(f"  {name}: {n} candidates, took the one at {row['frame'] * HOP / sr:.2f}s "
              f"(low {row['low']:.2f} mid {row['mid']:.2f} high {row['high']:.2f}, {row['after']:.2f}s clear after)")

    # Fourth pad: a second, heavier snare hit with some kick underneath it,
    # which is the closest thing this record has to a fourth drum.
    row = best_hit(
        [r for r in rows if r["frame"] not in used],
        lambda r: 0.2 < r["low"] < 0.6 and r["mid"] > 0.25,
        lambda r: r["loud"] ** 0.1,
    )
    if row:
        sf.write(KIT / "snare2.wav", cut(drums, sr, row, 0.45), sr, subtype="PCM_16")
        drum_list.append({"name": "SNARE 2", "file": "snare2.wav"})
        print(f"  SNARE 2: took the one at {row['frame'] * HOP / sr:.2f}s (low {row['low']:.2f} mid {row['mid']:.2f})")

    # The beat, taken apart: eight bars of the cleanest hook, one loop per stem,
    # and the sample itself (music plus its vocal) cut into one-bar phrases.
    info = sf.info(KIT / "full.flac")
    bars = 8
    bar = 4 * beat
    hook = find_hook(sr, bpm, first, info.duration, bars)
    hook_start = first + hook * bar
    print(f"cleanest hook: bars {hook + 1}-{hook + bars}, {hook_start:.2f}s to {hook_start + bars * bar:.2f}s")

    pads = []
    level = {"drums": 1.0, "bass": 1.0, "other": 1.0, "vocals": 1.0}
    for stem, name in [("drums", "DRUMS"), ("bass", "BASS"), ("other", "MUSIC"), ("vocals", "VOX")]:
        file = f"loop_{stem}.wav"
        sf.write(KIT / file, loop_cut(KIT / f"{stem}.flac", sr, hook_start, bars * bar) * level[stem], sr, subtype="PCM_16")
        pads.append({"name": name, "kind": "loop", "file": file, "bars": bars})

    sample = sf.read(KIT / "other.flac", dtype="float32", always_2d=True)[0] + sf.read(KIT / "vocals.flac", dtype="float32", always_2d=True)[0]
    sf.write(KIT / "_sample.flac", np.clip(sample, -1, 1), sr, subtype="PCM_16")
    for i in range(bars):
        file = f"phrase{i + 1}.wav"
        sf.write(KIT / file, loop_cut(KIT / "_sample.flac", sr, hook_start + i * bar, bar, fade_out=0.02), sr, subtype="PCM_16")
        pads.append({"name": f"PHRASE {i + 1}", "kind": "shot", "file": file})
    (KIT / "_sample.flac").unlink()
    drum_pads = [{"name": d["name"], "kind": "drum", "file": d["file"]} for d in drum_list]
    pads += drum_pads

    # If match_sample.py has traced the sample back to its source record, use
    # the real thing: the sample loop and the phrases come clean off the
    # source, and a second bank holds the chops as they sat on the pads.
    sample_info = None
    kit_start = hook_start
    map_path = KIT / "sample_map.json"
    if map_path.exists():
        sample_info = json.loads(map_path.read_text())
        # In the loop the sample sits at its level in the mix. Played alone
        # on a pad it wants to be as loud as the drum hits.
        shot_gain = round(min(8.0, 0.8 / float(np.abs(sf.read(KIT / "source_loop.wav")[0]).max())), 2)
        # The chorus is longer than the stretch nobody raps over, and it is
        # not always cut from the same time round. Every loop is cut to the
        # chorus's full length, from where match_sample.py placed it.
        bars = sample_info["bars"]
        kit_start = sample_info["start"]
        for stem in ("drums", "bass"):
            sf.write(KIT / f"loop_{stem}.wav", loop_cut(KIT / f"{stem}.flac", sr, kit_start, bars * bar), sr, subtype="PCM_16")
        # The sample comes in on a pickup, a little before the bar line. The
        # sample loop and the record loop carry that lead-in; it plays once,
        # and the loop then turns over from the bar line.
        lead = sample_info.get("lead_beats", 0) * beat
        if kit_start - lead < 0.004:
            raise SystemExit("the chosen chorus starts too close to the start of the song for its pickup")
        sf.write(KIT / "loop_full.wav", loop_cut(KIT / "full.flac", sr, kit_start - lead, bars * bar + lead), sr, subtype="PCM_16")
        empty = {"name": "", "kind": "empty"}

        def shot(name, file, source):
            return {"name": name, "kind": "shot", "file": file, "gain": shot_gain, "source": source}

        every = sample_info["chops"]
        chorus = [c for c in every if c["role"] == "chorus"]
        after = [c for c in every if c["role"] == "verse"]
        pickup = [c for c in every if c["role"] == "pickup"]
        per_line = len(chorus) // sample_info["lines"]

        # Bank A: the loops, the chorus line by line (the first line starts on
        # its pickup), the beds the verses are looped from, and the drum hits.
        row = [shot(f"LINE {i + 1}", f"source_line{i + 1}.wav", (pickup + chorus)[0]["source"] if i == 0 else chorus[i * per_line]["source"])
               for i in range(sample_info["lines"])][:6]
        by_n = {c["n"]: c for c in every}
        row += [shot(f"VERSE {i + 1}", f"source_verse{i + 1}.wav", by_n[n]["source"]) for i, n in enumerate(sample_info.get("verse_beds", []))]
        pads = [
            {"name": "DRUMS", "kind": "loop", "file": "loop_drums.wav", "bars": bars},
            {"name": "BASS", "kind": "loop", "file": "loop_bass.wav", "bars": bars},
            {"name": "SAMPLE", "kind": "loop", "file": "source_loop.wav", "bars": bars, "lead": round(lead, 5)},
            {"name": "RECORD", "kind": "loop", "file": "loop_full.wav", "bars": bars, "lead": round(lead, 5)},
        ] + (row + [empty] * 8)[:8] + (drum_pads + [empty] * 4)[:4]
        # Banks B and C: every chop in source order, one a pad, pickup first.
        singles = [shot("PICKUP", "source_pickup.wav", c["source"]) for c in pickup]
        singles += [shot(f"CHOP {c['n']:02d}", f"source_chop{c['n']:02d}.wav", c["source"]) for c in chorus + after]
        for i in range(0, min(len(singles), 32), 16):
            pads += (singles[i : i + 16] + [empty] * 16)[:16]
        print(f"sample traced to {sample_info['artist']}, {sample_info['title']}: "
              f"{bars}-bar chorus, {len(chorus)} chops, {len(after)} more under the verses")

    kit = {
        "title": "Through the Wire",
        "bpm": round(float(bpm), 3),
        "firstBeat": round(float(first), 4),
        "duration": round(info.duration, 3),
        "start": round(float(kit_start), 4),
        "hook_start": round(float(hook_start), 4),
        "pads": pads,
        "sample": sample_info and {k: sample_info[k] for k in ("title", "artist", "rate", "semitones", "chop_beats", "bars", "sampled")},
        "stems": [
            {"id": "full", "label": "FULL MIX", "file": "full.flac"},
            {"id": "nodrums", "label": "NO DRUMS", "file": "nodrums.flac"},
            {"id": "vocals", "label": "VOCALS", "file": "vocals.flac"},
            {"id": "music", "label": "MUSIC", "file": "music.flac"},
            {"id": "drums", "label": "DRUMS", "file": "drums.flac"},
        ],
        "drums": drum_list,
    }
    (KIT / "kit.json").write_text(json.dumps(kit, indent=2))
    print("wrote kit.json")


if __name__ == "__main__":
    main()
