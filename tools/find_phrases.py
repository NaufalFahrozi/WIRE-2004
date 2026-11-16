"""List the sung phrases in a stretch of the source record, with the gaps between them.

    .venv/Scripts/python tools/find_phrases.py "Through the Fire.mp3" 3:05 4:16

Pulls the vocal out of that stretch with Demucs and prints every run of
singing and how long the breath before it is. Bar lines are the wrong place to
cut a sung sample: a line usually starts a little before the bar and rings on
past it. Use the gaps printed here to fill in tools/phrases.json.
"""

import sys

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


def seconds(text):
    minutes, _, rest = text.rpartition(":")
    return int(minutes or 0) * 60 + float(rest)


def clock(t):
    return f"{int(t // 60)}:{t % 60:05.2f}"


def main(path, start, end):
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    seg = audio[int(start * sr) : int(end * sr)]
    model = get_model("htdemucs")
    model.eval()
    wav = torch.from_numpy(seg.T.copy())
    ref = wav.mean(0)
    with torch.no_grad():
        out = apply_model(model, ((wav - ref.mean()) / ref.std())[None], device="cpu", split=True, progress=False)[0]
    vocal = (out[model.sources.index("vocals")] * ref.std() + ref.mean()).mean(0).numpy()

    # Loudness every 10 ms; singing is anything within 13 dB of the loud parts.
    hop, win = int(0.01 * sr), int(0.03 * sr)
    level = np.array([np.sqrt(np.mean(vocal[i : i + win] ** 2)) for i in range(0, len(vocal) - win, hop)])
    db = 20 * np.log10(level + 1e-6)
    sung = db > np.percentile(db, 90) - 13

    runs = []
    i = 0
    while i < len(sung):
        if sung[i]:
            j = i
            while j < len(sung) and sung[j]:
                j += 1
            # A dip shorter than a tenth of a second is inside a word.
            if runs and (i - runs[-1][1]) * 0.01 < 0.1:
                runs[-1][1] = j
            else:
                runs.append([i, j])
            i = j
        else:
            i += 1

    last = None
    for a, b in runs:
        if (b - a) * 0.01 < 0.12:
            continue
        ta, tb = start + a * 0.01, start + b * 0.01
        gap = "" if last is None else f"   after a gap of {ta - last:.2f}s"
        print(f"{clock(ta)} - {clock(tb)}  ({tb - ta:5.2f}s){gap}")
        last = tb


if __name__ == "__main__":
    main(sys.argv[1], seconds(sys.argv[2]), seconds(sys.argv[3]))
