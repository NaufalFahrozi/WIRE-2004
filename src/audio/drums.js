// A small synthesized drum kit, so there is a beat to lay the chops over.
// Everything is generated with oscillators and noise; no samples.

export const DRUMS = ['KICK', 'SNARE', 'HAT', 'OPEN HAT']

const noiseCache = new WeakMap()
function noise(ctx) {
  let buf = noiseCache.get(ctx)
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseCache.set(ctx, buf)
  }
  return buf
}

function burst(ctx, out, t, { type, freq, q = 0.7, peak, decay }) {
  const src = ctx.createBufferSource()
  src.buffer = noise(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  filter.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(peak, t)
  g.gain.exponentialRampToValueAtTime(0.0008, t + decay)
  src.connect(filter).connect(g).connect(out)
  src.start(t, Math.random() * 0.5)
  src.stop(t + decay + 0.02)
}

export function playDrum(ctx, out, kind, t) {
  if (kind === 0) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.frequency.setValueAtTime(155, t)
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.11)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(1, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.42)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + 0.45)
    burst(ctx, out, t, { type: 'lowpass', freq: 2200, peak: 0.25, decay: 0.03 })
  } else if (kind === 1) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(240, t)
    osc.frequency.exponentialRampToValueAtTime(165, t + 0.08)
    g.gain.setValueAtTime(0.55, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.14)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + 0.16)
    burst(ctx, out, t, { type: 'bandpass', freq: 2600, q: 0.6, peak: 0.85, decay: 0.2 })
  } else if (kind === 2) {
    burst(ctx, out, t, { type: 'highpass', freq: 7800, peak: 0.34, decay: 0.045 })
  } else {
    burst(ctx, out, t, { type: 'highpass', freq: 6800, peak: 0.3, decay: 0.32 })
  }
}
