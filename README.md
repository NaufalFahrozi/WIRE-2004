# WIRE-2004

A browser sampler built around one record: Kanye West's "Through the Wire".

Kanye made the song by speeding up a chop of Chaka Khan's "Through the Fire". WIRE-2004 lets you do the same thing to his record: cut it into twelve chops, pitch it up, and sequence it over a drum kit.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

## Where the music comes from

No audio is stored in this repository.

- **Out of the box** the app asks Apple for its official 30-second preview of the song and streams it into the sampler.
- **For the whole song**, drop your own copy (MP3, WAV, M4A) anywhere on the page. It is decoded and kept in your browser only, and it is still there after a reload. "Back to preview" removes it.

## What it does

| | |
| --- | --- |
| 12 chop pads | Chop points found automatically on the transients, or on an even grid |
| Waveform screen | Drag a marker to move a chop, click a chop to hear it, click the strip above to chop a different 24 seconds of the song |
| Pitch | Twelve semitones up or down, varispeed, the way chipmunk soul was made |
| Tone, swing, volume | Low-pass filter on the sample, shuffle on the sequencer, master level |
| Choke and gate | Chops cut each other off, and optionally stop when you let go |
| 4 drum pads | Kick, snare, hat and open hat, synthesized in the browser |
| 16-step sequencer | A pattern per pad, live recording with REC, tap tempo, 83 BPM by default |

Your pattern and knob settings are saved in the browser.

## Keys

```
1 2 3 4      chops 1-4
Q W E R      chops 5-8
A S D F      chops 9-12
Z X C V      kick, snare, hat, open hat
SPACE        play / stop
```

## Layout

```
src/audio/engine.js     playback, sequencer, state
src/audio/slicer.js     transient detection and waveform peaks
src/audio/drums.js      synthesized drum kit
src/audio/store.js      keeps your own file in IndexedDB
src/components/         screen, pads, knobs, step sequencer
```

Built with React and Vite. No other runtime dependencies.

"Through the Wire" is the property of its rights holders. This is a fan project and ships none of the recording.
