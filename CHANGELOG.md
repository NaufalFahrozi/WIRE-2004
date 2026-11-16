# Changelog

Notable changes to WIRE-2004. Dates are year-month-day.

## 1.0.0 — 2026-11-16

The first release: the beat of "Through the Wire", traced back to its source and rebuilt on pads.

### The analysis

- Traces the sample to Chaka Khan's "Through the Fire" by waveform correlation: 1.2595 times faster, in two-beat chops, each re-triggered on the grid.
- Finds how far the chorus really runs (twelve bars and a pickup, where the part nobody raps over is only eight) by following the source for as long as it turns up the same way every time the chorus comes round.
- Measures how it was sampled: mono, off the left channel, highs rolled off, at about a quarter of the source's level.
- Maps the whole song bar by bar: the chorus plays the source straight through, the verses loop the bars after it.
- Cuts the phrase pads where the singer breathes, not on the bar lines.

### The sampler

- Four banks: the beat rebuilt, the chops as they sat on the pads (two banks), and a bank for cutting your own from any of five stems.
- Loops that come in on the bar line and stay in time; the sample and the record enter on their pickup.
- A sixteen-step sequencer with live recording, swing and tap tempo.
- Pitch, tone and volume; choke and gate.
- A waveform screen with the playhead, bar lines, and where in the source each chop comes from.
- Keys for every pad, for the banks, and for stopping everything.
- Works on a phone.

### The project

- Tests for the slicer, a self-test that checks the sample matcher against a case with a known answer, and CI that runs both.
- Figures drawn from the measurements, redrawn with `docs/make_figures.py`.
- MIT licence for the code. No recording is in the repository.
