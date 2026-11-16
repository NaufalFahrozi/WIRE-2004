# WIRE-2004

A browser sampler that takes Kanye West's "Through the Wire" apart and hands you the pieces.

The beat is Chaka Khan's "Through the Fire", sped up, chopped, and re-triggered under new drums and bass. WIRE-2004 works that out from the two records and puts it on pads: the chops as they sat on the sampler, the drums and bass that were added, and the finished record to compare against.

## How the beat was made

Lining the two recordings up shows it. The source recording is inside the finished mix, so their waveforms correlate, which places every piece to a fraction of a millisecond.

Every bit of sample in the song comes from one minute of "Through the Fire", its last chorus and what follows, from 3:11 to 4:10:

| In the song | Bars | From the source |
| --- | --- | --- |
| Chorus (intro, and twice more) | 1-12, 27-38, 61-72 | 3:13 to 3:57, twelve bars straight through, with a two-beat pickup from 3:11 |
| Verse, first pattern | 13-20, 39-54 | A one-bar loop from 3:58 to 4:02, set one beat late, with a turnaround every four bars |
| Verse, second pattern, and the outro | 21-26, 55-60, 73-75 | A two-bar loop from 4:02.5 to 4:10 |

How it was treated:

- It runs **1.2595 times faster, +3.99 semitones**: four semitones up on the sampler.
- It is cut into **chops of two beats**. The chops play in order, but each is **re-triggered on the grid**. The source was played by people and drifts; against a steady 83 BPM the chops land up to 130 ms away from where a straight copy would put them.
- It was sampled **in mono, from the left channel only**. The right channel of the source is not in the record.
- The highs are rolled off, about 5 dB down at 4-8 kHz and gone above 8 kHz, the way a sampler's filter does it. Below that the tone is flat.
- It sits at about a quarter of its original level, with its polarity flipped.
- New drums and bass are laid on top.

Of the chorus's 24 chops, 22 were found in the record's waveform outright, each well clear of chance; the other two sit under louder parts and take their place from their neighbours. The pads carry the sample the way it is on the record: left channel, sped up, low-passed, at that level.

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
| `build_kit.py` | Finds the tempo and bar lines, finds the eight bars where the sample plays with the least rapping over it, and picks the cleanest kick, snare and hi-hat hits out of the drum stem |
| `match_sample.py` | Traces the sample back to the source record: how much it was sped up, how far the chorus really runs, which piece of the source sits under each chop, and how it was sampled. Cuts the chops out of the source itself |
| `build_kit.py` again | Cuts the drum, bass and record loops to the chorus's full length and puts the traced sample on the pads |

Everything is written to `public/kit/`, which is git-ignored, and the app loads it on its own. Skip the last two steps and the sample pads fall back to stems separated from the finished song. With no kit at all, for example on a fresh clone, the app plays Apple's official 30-second preview with a synthesized drum kit standing in.

## What it does

| | |
| --- | --- |
| Bank A, the beat | The chorus rebuilt. Four twelve-bar loops that stack in time: the added drums, the added bass, the sample cut clean from the source record, and the finished record to compare against. Then the sample line by line (two bars a pad), the pickup that leads into it, the bed that runs under the verses, and four drum hits |
| Banks B and C, the chops | The sample chop by chop, the way it sat on the pads: the chorus's 24 two-beat chops, then the 7 that the verses are looped from, straight off "Through the Fire". In order they make the record; out of order they make something new |
| Bank D, chop it | Twelve chops you place yourself anywhere in the song: cut on the beat, or on the transients, from the full mix or from any of five stems |
| Synced loops | A loop you tap comes in on the next bar line and joins at the bar the others have reached. Change the tempo and the loops speed up with it, like tape |
| Waveform screen | Shows the selected sound with its playhead, and for a chop, where in the source record it comes from. In bank D, drag a marker to move a chop and click the strip above to move to another part of the song |
| Pitch | Twelve semitones up or down on the chops, varispeed, the way chipmunk soul was made |
| Tone, swing, volume | Low-pass filter on the sample, shuffle on the sequencer, master level |
| Choke and gate | Chops cut each other off, and optionally stop when you let go |
| 16-step sequencer | A pattern per pad, live recording with REC, tap tempo, at the song's own 83 BPM |

Your pattern and knob settings are saved in the browser.

## Keys

```
             Bank A                        Bank B        Bank C               Bank D
1 2 3 4      drums, bass, sample, record   chops 1-4     chops 17-20          your chops 1-4
Q W E R      lines 1-4                     chops 5-8     chops 21-24          your chops 5-8
A S D F      lines 5-6, pickup, verse      chops 9-12    chops 25-28          your chops 9-12
Z X C V      kick, snare, hat, snare 2     chops 13-16   chops 29-31, pickup  kick, snare, hat, snare 2
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
