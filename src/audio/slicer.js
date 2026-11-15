// Waveform analysis: where to chop, and what to draw.

const HOP = 512
const WIN = 1024

function monoAt(buffer) {
  const a = buffer.getChannelData(0)
  const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  return b ? (i) => (a[i] + b[i]) * 0.5 : (i) => a[i]
}

// Evenly spaced chop points across the region.
export function gridSlices(start, len, count) {
  return Array.from({ length: count }, (_, i) => start + (len * i) / count)
}

// Transient-based chop points: find the strongest jumps in loudness and keep
// the best `count` that are not crowded together. The first chop always sits
// at the start of the region.
export function detectOnsets(buffer, start, len, count) {
  const sr = buffer.sampleRate
  const at = monoAt(buffer)
  const s0 = Math.floor(start * sr)
  const frames = Math.max(0, Math.floor((len * sr - WIN) / HOP))
  if (frames < count * 2) return gridSlices(start, len, count)

  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    const base = s0 + f * HOP
    // Sample-to-sample difference favours highs, so drum hits and consonants
    // stand out even on a loud, heavily limited master.
    for (let i = 1; i < WIN; i += 2) {
      const v = (at(base + i) || 0) - (at(base + i - 1) || 0)
      sum += v * v
    }
    energy[f] = Math.log(1e-7 + sum)
  }

  const peaks = []
  for (let f = 4; f < frames - 1; f++) {
    const before = (energy[f - 1] + energy[f - 2] + energy[f - 3]) / 3
    const flux = energy[f] - before
    const prevFlux = energy[f - 1] - (energy[f - 2] + energy[f - 3] + energy[f - 4]) / 3
    const nextFlux = energy[f + 1] - (energy[f] + energy[f - 1] + energy[f - 2]) / 3
    if (flux > 0.25 && flux >= prevFlux && flux > nextFlux) peaks.push({ f, flux })
  }
  peaks.sort((a, b) => b.flux - a.flux)

  const minGap = (len / count) * 0.4
  const picked = [start]
  for (const p of peaks) {
    if (picked.length >= count) break
    // Back off a hair so the attack is inside the chop.
    const t = start + (p.f * HOP) / sr - 0.008
    if (t - start < minGap || start + len - t < minGap * 0.5) continue
    if (picked.every((q) => Math.abs(q - t) >= minGap)) picked.push(t)
  }

  // Quiet passage with few transients: fill the widest gaps evenly.
  while (picked.length < count) {
    picked.sort((a, b) => a - b)
    let best = 0
    let gap = 0
    for (let i = 0; i < picked.length; i++) {
      const end = i + 1 < picked.length ? picked[i + 1] : start + len
      if (end - picked[i] > gap) {
        gap = end - picked[i]
        best = picked[i]
      }
    }
    picked.push(best + gap / 2)
  }
  return picked.sort((a, b) => a - b)
}

// Min/max pairs per column, for drawing. Returns Float32Array [min0, max0, min1, ...].
export function peaks(buffer, start, len, cols) {
  const sr = buffer.sampleRate
  const at = monoAt(buffer)
  const out = new Float32Array(cols * 2)
  const s0 = start * sr
  const per = (len * sr) / cols
  const stride = Math.max(1, Math.floor(per / 160))
  for (let c = 0; c < cols; c++) {
    let lo = 0
    let hi = 0
    const a = Math.floor(s0 + c * per)
    const b = Math.min(buffer.length, Math.floor(a + per))
    for (let i = a; i < b; i += stride) {
      const v = at(i)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    out[c * 2] = lo
    out[c * 2 + 1] = hi
  }
  return out
}
