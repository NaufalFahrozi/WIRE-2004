# Contributing

Thanks for looking. A few things that make a change easy to take.

## The one rule

**No audio in the repository.** Not the two songs, not stems, not chops, not a ten-second clip. The kit is built on each person's own machine from copies they own, and it stays in `public/kit/`, which is git-ignored. A pull request that adds a recording will be closed.

Numbers are fine. Tempo, bar lines, chop positions and phrase times are measurements, and `tools/phrases.json` is where the phrase cuts live.

## Getting set up

```bash
npm install
```

```bash
npm run dev
```

To work on the rebuilt beat rather than the fallback, build a kit first. The steps are in the [README](README.md#build-the-kit).

## Before you open a pull request

```bash
npm test
```

```bash
npm run build
```

```bash
python tools/selftest.py
```

The last one needs `numpy`, `scipy` and `soundfile`, and no recordings. It makes up a piece of music, speeds part of it up, and checks that the matcher finds the speed and the place.

## If a cut sounds wrong

A pad that starts late, clips a word or runs on too long is the most useful thing to report. Say which pad, and which way it is off (starts too early, starts too late, ends too early, ends too late). The cuts are measured from loudness, not heard, so an ear is exactly what they need. There is an issue template for it.

## Style

- Plain names, short functions, comments that say why.
- The interface sits on a 4px spacing grid, with one neutral ramp and one accent. The reasoning is at the top of `src/styles.css`.
- Commit messages say what changed, in the imperative.
