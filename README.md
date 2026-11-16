# WIRE-2004

A browser sampler that takes Kanye West's "Through the Wire" apart and hands you the pieces.

The beat is Chaka Khan's "Through the Fire", sped up, chopped, and re-triggered under new drums and bass. WIRE-2004 works that out from the two records and puts it on pads: the chops as they sat on the sampler, the drums and bass that were added, and the finished record to compare against.

## How the beat was made

Lining the two recordings up shows it. The source recording is inside the finished mix, so their waveforms correlate, which places every piece to a fraction of a millisecond:

- "Through the Fire" runs **1.2595 times faster, +3.99 semitones**: four semitones up on the sampler.
- The eight-bar hook is the last chorus of the source, from **3:20.5**, cut into **sixteen chops of two beats each**.
- The chops play in order, but each is **re-triggered on the grid**. The source was played by people and drifts; against a steady 83 BPM the chops land between 54 ms early and 96 ms late of where a straight copy would put them.
- The sample sits in the mix with its polarity flipped.
- New drums and bass are laid on top.

All sixteen chops were found in the record's waveform, each 10 to 20 standard deviations clear of chance.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

## Where the sounds come from

Every sound is cut from the two records. Nothing is borrowed from a sample pack, and no audio is stored in this repository. The kit is built on your own machine from copies of the songs you own:

```bash
python -m venv --system-site-packages .venv
```

```bash
.venv/Scripts/python -m pip install demucs soundfile
```

```bash
.venv/Scripts/python tools/separate.py "Through The Wire.mp3"
```

```bash
.venv/Scripts/python tools/build_kit.py
```

```bash
.venv/Scripts/python tools/match_sample.py "Through the Fire.mp3"
```

```bash
.venv/Scripts/python tools/build_kit.py
```

| Step | What it does |
| --- | --- |
| `separate.py` | Splits the song into stems with Demucs (a few minutes on a CPU) |
| `build_kit.py` | Finds the tempo and bar lines, finds the eight bars where the sample plays with the least rapping over it, cuts the drum and bass loops, and picks the cleanest kick, snare and hi-hat hits out of the drum stem |
| `match_sample.py` | Traces the sample back to the source record: how much it was sped up, and which piece of the source sits under each chop. Cuts the chops out of the source itself |
| `build_kit.py` again | Puts the traced sample on the pads |

Everything is written to `public/kit/`, which is git-ignored, and the app loads it on its own. Skip the last two steps and the sample pads fall back to stems separated from the finished song. With no kit at all, for example on a fresh clone, the app plays Apple's official 30-second preview with a synthesized drum kit standing in.

## What it does

| | |
| --- | --- |
| Bank A, the beat | The hook rebuilt. Four loops that stack in time: the added drums, the added bass, the sample cut clean from the source record, and the finished record to compare against. Then the sample one bar per pad, and four drum hits |
| Bank B, the chops | The sixteen two-beat chops as they sat on the pads, straight off "Through the Fire". In order they make the hook; out of order they make something new |
| Bank C, chop it | Twelve chops you place yourself anywhere in the song: cut on the beat, or on the transients, from the full mix or from any of five stems |
| Synced loops | A loop you tap comes in on the next bar line and joins at the bar the others have reached. Change the tempo and the loops speed up with it, like tape |
| Waveform screen | Shows the selected sound with its playhead, and for a chop, where in the source record it comes from. In bank C, drag a marker to move a chop and click the strip above to move to another part of the song |
| Pitch | Twelve semitones up or down on the chops, varispeed, the way chipmunk soul was made |
| Tone, swing, volume | Low-pass filter on the sample, shuffle on the sequencer, master level |
| Choke and gate | Chops cut each other off, and optionally stop when you let go |
| 16-step sequencer | A pattern per pad, live recording with REC, tap tempo, at the song's own 83 BPM |

Your pattern and knob settings are saved in the browser.

## Keys

```
             Bank A                        Bank B          Bank C
1 2 3 4      drums, bass, sample, record   chops 1-4       chops 1-4
Q W E R      phrases 1-4                   chops 5-8       chops 5-8
A S D F      phrases 5-8                   chops 9-12      chops 9-12
Z X C V      kick, snare, hat, snare 2     chops 13-16     kick, snare, hat, snare 2
SPACE        play / stop
```

## Layout

```
src/audio/engine.js     playback, kit loading, loops, sequencer, state
src/audio/slicer.js     transient detection and waveform peaks
src/audio/drums.js      fallback drum synth for when there is no kit
src/components/         screen, pads, knobs, step sequencer
tools/separate.py       song -> stems
tools/build_kit.py      stems -> tempo, bar lines, loops, drum hits, kit.json
tools/match_sample.py   source record -> speed, chop map, the chops themselves
```

Built with React and Vite. No other runtime dependencies.

"Through the Wire" and "Through the Fire" are the property of their rights holders. This is a fan project and ships neither recording.
