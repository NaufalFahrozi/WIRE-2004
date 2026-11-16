"""Draw the README's figures from the measurements in public/kit/.

    .venv/Scripts/python docs/make_figures.py

Writes banner.svg, beat-map.svg and chop-shifts.svg next to this file. The
numbers come from sample_map.json and kit.json (made by tools/match_sample.py
and tools/build_kit.py); the banner's waveform is the shape of the rebuilt
sample loop. No audio ends up in the pictures.
"""

import json
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
KIT = HERE.parent / "public" / "kit"

SURFACE = "#140c0b"
PANEL = "#1f1513"
INK = "#f4ead6"
INK_2 = "#b7a892"
INK_3 = "#7d7265"
RULE = "#3a2b27"
# Categorical, checked on this surface for lightness, chroma, colour-blind
# separation and contrast. Fixed order: chorus, verse bed, verse phrase.
GOLD, ROSE, BLUE = "#b8831c", "#cf5468", "#2c9fc0"
FONT = "'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'Cascadia Mono', Consolas, 'Courier New', monospace"

# Which stretch of the source each bar of the song plays, from mapping the
# record beat by beat against the source (bars are 1-based, inclusive).
SECTIONS = [
    (1, 12, "chorus"), (13, 20, "bed"), (21, 26, "phrase"),
    (27, 38, "chorus"), (39, 54, "bed"), (55, 60, "phrase"),
    (61, 72, "chorus"), (73, 75, "phrase"),
]
COLOUR = {"chorus": GOLD, "bed": ROSE, "phrase": BLUE}


def clock(t):
    return f"{int(t // 60)}:{int(t % 60):02d}"


def text(x, y, s, size=14, fill=INK, anchor="start", weight=400, font=FONT, extra=""):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{font}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}" {extra}>{s}</text>')


def svg(w, h, body, title, desc):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
            f'aria-labelledby="t d"><title id="t">{title}</title><desc id="d">{desc}</desc>'
            f'<rect width="{w}" height="{h}" rx="14" fill="{SURFACE}"/>{"".join(body)}</svg>')


def banner(loop_path, n_chops, lead_fraction):
    w, h = 1200, 322
    audio, _ = sf.read(loop_path, always_2d=True)
    mono = audio.mean(1)
    cols = 232
    # Loudness per column, stretched a little so the quiet moments read as dips.
    peaks = np.array([np.sqrt(np.mean(chunk**2)) for chunk in np.array_split(mono, cols)])
    peaks = (peaks / peaks.max()) ** 1.6
    x0, x1, mid, amp = 60, w - 60, 208, 52
    step = (x1 - x0) / cols
    body = [
        text(60, 96, "WIRE-2004", 78, INK, weight=800, font="'Barlow Condensed', 'Arial Narrow', Arial, sans-serif",
             extra='letter-spacing="1"'),
        f'<rect x="56" y="70" width="372" height="3" fill="#e8a923"/>',
        text(446, 96, "chipmunk soul sampler", 24, "#e8a923", weight=600),
        text(w - 60, 62, "Kanye West’s “Through the Wire”,", 17, INK_2, anchor="end"),
        text(w - 60, 86, "taken apart and put back in your hands.", 17, INK_2, anchor="end"),
        f'<rect x="{x0 - 16}" y="{mid - amp - 22}" width="{x1 - x0 + 32}" height="{2 * amp + 44}" rx="8" fill="#1a1204"/>',
    ]
    for i, p in enumerate(peaks):
        bar = max(2, p * amp)
        body.append(f'<rect x="{x0 + i * step:.1f}" y="{mid - bar:.1f}" width="{step * 0.55:.1f}" height="{2 * bar:.1f}" fill="#ffb62e"/>')
    # One tick per chop, the pickup first.
    span = x1 - x0
    for k in range(n_chops + 1):
        x = x0 + (lead_fraction + (1 - lead_fraction) * k / n_chops) * span
        body.append(f'<rect x="{x - 1:.1f}" y="{mid - amp - 6}" width="3" height="{2 * amp + 12}" fill="#1a1204"/>')
        body.append(f'<rect x="{x - 0.5:.1f}" y="{mid - amp - 16}" width="1" height="{2 * amp + 32}" fill="#a8731a"/>')
    body.append(text(x0, h - 14, f"the sample: a two-beat pickup and {n_chops} chops, as rebuilt from the source record", 13, INK_3, font=MONO))
    return svg(w, h, body, "WIRE-2004", "Wordmark over the waveform of the rebuilt sample, with a tick at each chop.")


def beat_map(sample):
    w, h = 1200, 470
    left, right = 60, w - 60
    span = right - left
    body = [
        text(left, 44, "Every bar of the song, and where in the source it comes from", 22, INK, weight=600),
        text(left, 68, "All the sample in the record is cut from one minute of “Through the Fire”: its last chorus, and the bars after it.", 14, INK_2),
    ]

    # The source record, whole.
    src_len = 288.7
    y = 122
    body.append(text(left, y - 14, "THROUGH THE FIRE · Chaka Khan · the source, 4:49", 12, INK_3, weight=600, extra='letter-spacing="1"'))
    body.append(f'<rect x="{left}" y="{y}" width="{span}" height="10" rx="5" fill="{RULE}"/>')
    chops = sample["chops"]
    a = min(c["source"] for c in chops)
    b = max(c["source"] for c in chops) + sample["chop_beats"] * 60 / 82.988 * sample["rate"]
    xa, xb = left + span * a / src_len, left + span * b / src_len
    body.append(f'<rect x="{xa:.1f}" y="{y}" width="{xb - xa:.1f}" height="10" fill="{INK}"/>')
    for m in range(0, 5):
        x = left + span * m * 60 / src_len
        body.append(f'<rect x="{x:.1f}" y="{y + 14}" width="1" height="5" fill="{INK_3}"/>')
        body.append(text(x, y + 34, f"{m}:00", 11, INK_3, anchor="middle", font=MONO))

    # The sampled minute, enlarged and split by what it is used for.
    y2 = 206
    body.append(f'<path d="M{xa:.1f},{y + 10} L{left},{y2} M{xb:.1f},{y + 10} L{right},{y2}" stroke="{RULE}" stroke-width="1" fill="none"/>')
    chorus_end = max(c["source"] for c in chops if c["role"] == "chorus") + (b - max(c["source"] for c in chops))
    phrase_from = sorted(c["source"] for c in chops if c["role"] == "verse")[-4]
    parts = [("chorus", a, chorus_end, "the chorus, with its pickup"), ("bed", chorus_end, phrase_from, "one bar of music"),
             ("phrase", phrase_from, b, "a sung phrase")]
    for kind, s0, s1, label in parts:
        x0 = left + span * (s0 - a) / (b - a)
        x1 = left + span * (s1 - a) / (b - a)
        body.append(f'<rect x="{x0 + 1:.1f}" y="{y2}" width="{x1 - x0 - 2:.1f}" height="34" rx="4" fill="{COLOUR[kind]}"/>')
        body.append(text(x0 + 4, y2 + 54, f"{clock(s0)} – {clock(s1)}", 12, INK, font=MONO))
        body.append(text(x0 + 4, y2 + 72, label, 12, INK_2))

    # The song, bar by bar.
    y3 = 338
    body.append(text(left, y3 - 34, "THROUGH THE WIRE · Kanye West · the record, 75 bars", 12, INK_3, weight=600, extra='letter-spacing="1"'))
    n = 75
    cell = span / n
    for first, last, kind in SECTIONS:
        for bar in range(first, last + 1):
            x = left + (bar - 1) * cell
            body.append(f'<rect x="{x + 1:.1f}" y="{y3}" width="{cell - 2:.1f}" height="44" rx="3" fill="{COLOUR[kind]}"/>')
        x = left + (first - 1) * cell
        body.append(f'<rect x="{x:.1f}" y="{y3 - 10}" width="1" height="8" fill="{INK_3}"/>')
        body.append(text(x + 3, y3 - 8, str(first), 11, INK_3, font=MONO))
        mid = left + (first + last) / 2 * cell - cell / 2
        if last - first >= 5:
            body.append(text(mid, y3 + 62, {"chorus": "chorus", "bed": "verse", "phrase": "verse"}[kind], 12, INK_2, anchor="middle"))

    # Legend.
    y4 = h - 26
    x = left
    for kind, label in [("chorus", "Chorus: twelve bars straight through"), ("bed", "Verse: the one bar of music, looped"),
                        ("phrase", "Verse and outro: the two-bar sung phrase, looped")]:
        body.append(f'<rect x="{x}" y="{y4 - 11}" width="14" height="14" rx="3" fill="{COLOUR[kind]}"/>')
        body.append(text(x + 22, y4, label, 13, INK))
        x += 44 + len(label) * 7.1
    return svg(w, h, body, "Where every bar of the song comes from",
               "Bars 1 to 12, 27 to 38 and 61 to 72 play the source's last chorus straight through. "
               "Bars 13 to 20 and 39 to 54 loop one bar of music from just after it. "
               "Bars 21 to 26, 55 to 60 and 73 to 75 loop a two-bar sung phrase after that.")


def chop_shifts(sample):
    w, h = 1200, 420
    left, right, top, bottom = 90, w - 60, 110, h - 70
    chorus = [c for c in sample["chops"] if c["role"] == "chorus"]
    base = chorus[0]["shift_ms"]
    vals = [c["shift_ms"] - base for c in chorus]
    lo, hi = 0, 250
    X = lambda i: left + (right - left) * (i + 0.5) / len(vals)
    Y = lambda v: bottom - (bottom - top) * (v - lo) / (hi - lo)
    body = [
        text(60, 44, "Every chop is re-triggered on the grid", 22, INK, weight=600),
        text(60, 68, "How far each chorus chop sits from an unbroken copy of the source lined up on chop 1. "
                     "The singers and players drift; the sampler pulls each chop back into time.", 14, INK_2),
    ]
    for v in range(0, 251, 50):
        body.append(f'<rect x="{left}" y="{Y(v):.1f}" width="{right - left}" height="1" fill="{RULE}"/>')
        body.append(text(left - 10, Y(v) + 4, f"+{v} ms" if v else "0", 12, INK_3, anchor="end", font=MONO))
    pts = " ".join(f"{X(i):.1f},{Y(v):.1f}" for i, v in enumerate(vals))
    body.append(f'<polyline points="{pts}" fill="none" stroke="{GOLD}" stroke-width="2" stroke-linejoin="round"/>')
    for i, (c, v) in enumerate(zip(chorus, vals)):
        # A hollow marker where the chop sat under louder parts and was placed from its neighbours.
        fill = SURFACE if c["guessed"] else GOLD
        body.append(f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="5" fill="{fill}" stroke="{GOLD}" stroke-width="2"/>')
        body.append(text(X(i), bottom + 20, str(c["n"]), 11, INK_3, anchor="middle", font=MONO))
    peak = int(np.argmax(vals))
    body.append(text(X(peak) - 10, Y(vals[peak]) - 12, f"+{vals[peak]:.0f} ms", 13, INK, anchor="end", weight=600))
    body.append(text((left + right) / 2, bottom + 44, "chop (two beats each, twelve bars in all)", 12, INK_2, anchor="middle"))
    body.append(f'<circle cx="{right - 250}" cy="{top - 18}" r="5" fill="{SURFACE}" stroke="{GOLD}" stroke-width="2"/>')
    body.append(text(right - 238, top - 14, "placed from its neighbours", 12, INK_2))
    return svg(w, h, body, "Every chop is re-triggered on the grid",
               "Line chart of the shift of each of the chorus's chops against an unbroken copy of the source, "
               f"rising unevenly from zero at chop 1 to about {max(vals):.0f} milliseconds.")


def main():
    sample = json.loads((KIT / "sample_map.json").read_text())
    n_chorus = sum(c["role"] == "chorus" for c in sample["chops"])
    lead = sample["lead_beats"] / (sample["lead_beats"] + n_chorus * sample["chop_beats"])
    (HERE / "banner.svg").write_text(banner(KIT / "source_loop.wav", n_chorus, lead), encoding="utf-8")
    (HERE / "beat-map.svg").write_text(beat_map(sample), encoding="utf-8")
    (HERE / "chop-shifts.svg").write_text(chop_shifts(sample), encoding="utf-8")
    shifts = [c["shift_ms"] for c in sample["chops"] if c["role"] == "chorus"]
    print("wrote banner.svg, beat-map.svg, chop-shifts.svg")
    print({k: sample[k] for k in ("rate", "semitones", "gain", "lowpass_hz", "sampled", "flipped", "bars")},
          "chorus shifts", min(shifts), max(shifts), "guessed", [c["n"] for c in sample["chops"] if c["guessed"]])


if __name__ == "__main__":
    main()
