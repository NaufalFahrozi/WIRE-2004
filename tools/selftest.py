"""Check the sample matcher against a case where the answer is known.

    python tools/selftest.py

Makes up a piece of music, speeds a stretch of it up by a known amount, buries
it under noise, and asks match_sample's two passes to say how much it was sped
up and where it came from. Needs no recordings, so it runs anywhere.
"""

import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parent))
import match_sample as M  # noqa: E402

SR = 22050
RATE = 1.26          # how much faster the "record" plays the "source"
FROM = 31.0          # where in the source the sampled stretch starts, in seconds
SPAN = 16.0          # how long the sampled stretch is in the record, in seconds


def made_up_music(seconds, rng):
    """Chords that change twice a second, so there is pitch content to follow."""
    t = np.arange(int(seconds * SR)) / SR
    out = np.zeros_like(t)
    for start in np.arange(0, seconds, 0.5):
        on = (t >= start) & (t < start + 0.5)
        fade = np.exp(-(t[on] - start) * 4)
        for note in rng.choice(np.arange(45, 76), size=3, replace=False):
            hz = 440 * 2 ** ((note - 69) / 12)
            out[on] += np.sin(2 * np.pi * hz * t[on]) * fade
    return (out / np.abs(out).max() * 0.6).astype(np.float32)


def main():
    rng = np.random.default_rng(2004)
    source = made_up_music(90, rng)

    # The record: that stretch of the source played faster, with other things on top.
    ratio = Fraction(1 / RATE).limit_denominator(1000)
    a = int(FROM * SR)
    record = resample_poly(source[a : a + int(SPAN * RATE * SR)], ratio.numerator, ratio.denominator)[: int(SPAN * SR)]
    record = (record + rng.normal(0, 0.1, len(record))).astype(np.float32)

    rate, fit, _, start = M.coarse(record[:, None], SR, source[:, None], SR)
    print(f"coarse pass: {rate:.4f}x from {start:.2f}s (fit {fit:.2f}); the truth is {RATE}x from {FROM:.2f}s")
    assert abs(rate - RATE) < 0.006, "the coarse pass got the speed wrong"
    assert abs(start - FROM) < 0.15, "the coarse pass got the place wrong"

    # The fine pass: the waveform itself, to the sample.
    fs = SR // M.DECIMATE
    pad = 0.3
    target = M.band(record[:, None], SR)
    sped = M.band(M.sped_source(source[:, None], SR, SR, RATE, start, SPAN, pad), SR)
    n = int(2.0 * fs)
    lag, stand_out, _ = M.best_lag(target[:n], sped[: n + int(2 * pad * fs)], pad, fs)
    true_lag = (FROM - start) / RATE
    print(f"fine pass:   off by {abs(lag - true_lag) * 1000:.2f} ms, {stand_out:.0f} standard deviations clear of chance")
    assert abs(lag - true_lag) < 0.001, "the fine pass missed by more than a millisecond"
    assert stand_out > 8, "the fine pass did not find a clear match"
    print("ok")


if __name__ == "__main__":
    main()
