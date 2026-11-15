"""Split a song you own into stems, entirely on this machine.

    .venv/Scripts/python tools/separate.py "Through The Wire.mp3"

Writes FLAC stems into public/kit/. Nothing is uploaded anywhere, and the
output folder is git-ignored. Run tools/build_kit.py afterwards.
"""

import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "kit"


def main(src):
    OUT.mkdir(parents=True, exist_ok=True)
    audio, sr = sf.read(src, dtype="float32", always_2d=True)
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)

    model = get_model("htdemucs")
    model.eval()
    if sr != model.samplerate:
        raise SystemExit(f"expected {model.samplerate} Hz audio, got {sr}")

    wav = torch.from_numpy(audio.T.copy())
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std()
    with torch.no_grad():
        out = apply_model(model, ((wav - mean) / std)[None], device="cpu", split=True, overlap=0.25, progress=True)[0]
    out = out * std + mean
    stems = {name: out[i].numpy().T for i, name in enumerate(model.sources)}

    files = {
        "full": audio,
        "nodrums": stems["bass"] + stems["other"] + stems["vocals"],
        "vocals": stems["vocals"],
        "music": stems["bass"] + stems["other"],
        "drums": stems["drums"],
    }
    for name, data in files.items():
        sf.write(OUT / f"{name}.flac", np.clip(data, -1, 1), sr, subtype="PCM_16")
        print("wrote", name)


if __name__ == "__main__":
    main(sys.argv[1])
