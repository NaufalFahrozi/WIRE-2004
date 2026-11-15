# WIRE-2004

A browser sampler built around one record: Kanye West's "Through the Wire".

Kanye made the song by speeding up a chop of Chaka Khan's "Through the Fire". WIRE-2004 lets you do the same thing to his record: cut it into twelve chops, pitch it up, and sequence it over drums lifted out of the song itself.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

## Where the sounds come from

Every sound is cut from the record. Nothing is synthesized or borrowed from a sample pack, and no audio is stored in this repository.

The kit is built on your own machine from a copy of the song you own:

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

`separate.py` splits the song into stems with Demucs (a few minutes on a CPU). `build_kit.py` finds the tempo and the bar lines, then picks the cleanest kick, snare and hi-hat hits out of the drum stem. Both write into `public/kit/`, which is git-ignored, and the app loads it on its own.

Without a kit, for example on a fresh clone, the app falls back to Apple's official 30-second preview with a synthesized drum kit standing in.

## What it does

| | |
| --- | --- |
| 12 chop pads | Six bars of the song cut on the beat, two beats per chop, or cut on the transients instead |
| 5 stems | Chop the full mix, the song without drums, the vocals, the music, or the drums alone |
| 4 drum pads | Kick, snare, hi-hat and a second snare, all taken from the record |
| Waveform screen | Drag a marker to move a chop, click a chop to hear it, click the strip above to move to another part of the song (it snaps to the bar) |
| Pitch | Twelve semitones up or down, varispeed, the way chipmunk soul was made |
| Tone, swing, volume | Low-pass filter on the sample, shuffle on the sequencer, master level |
| Choke and gate | Chops cut each other off, and optionally stop when you let go |
| 16-step sequencer | A pattern per pad, live recording with REC, tap tempo, at the song's own 83 BPM |

Your pattern and knob settings are saved in the browser.

## Keys

```
1 2 3 4      chops 1-4
Q W E R      chops 5-8
A S D F      chops 9-12
Z X C V      kick, snare, hat, snare 2
SPACE        play / stop
```

## Layout

```
src/audio/engine.js     playback, kit loading, sequencer, state
src/audio/slicer.js     transient detection and waveform peaks
src/audio/drums.js      fallback drum synth for when there is no kit
src/components/         screen, pads, knobs, step sequencer
tools/separate.py       song -> stems
tools/build_kit.py      stems -> tempo, bar lines, drum one-shots, kit.json
```

Built with React and Vite. No other runtime dependencies.

"Through the Wire" is the property of its rights holders. This is a fan project and ships none of the recording.
