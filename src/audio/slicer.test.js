import { describe, expect, it } from 'vitest'
import { detectOnsets, gridSlices, peaks } from './slicer.js'

const SR = 44100

// Just enough of an AudioBuffer for the slicer to read.
function buffer(samples, right) {
  const channels = right ? [samples, right] : [samples]
  return {
    sampleRate: SR,
    length: samples.length,
    duration: samples.length / SR,
    numberOfChannels: channels.length,
    getChannelData: (c) => channels[c],
  }
}

// Quiet hiss with a short loud burst at each of the given times.
function clicks(seconds, times) {
  let seed = 7
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const data = new Float32Array(Math.round(seconds * SR))
  for (let i = 0; i < data.length; i++) data[i] = noise() * 0.002
  for (const t of times) {
    const start = Math.round(t * SR)
    for (let i = 0; i < 2000; i++) data[start + i] = noise() * 0.8 * Math.exp(-i / 400)
  }
  return data
}

describe('gridSlices', () => {
  it('spaces the chops evenly from the start of the window', () => {
    expect(gridSlices(10, 12, 4)).toEqual([10, 13, 16, 19])
  })
})

describe('detectOnsets', () => {
  const hits = [1.5, 3.1, 4.4, 6.2, 7.9]
  const found = detectOnsets(buffer(clicks(10, hits)), 0, 10, 6)

  it('returns the number of chops asked for, in order, starting at the window start', () => {
    expect(found).toHaveLength(6)
    expect(found[0]).toBe(0)
    expect([...found].sort((a, b) => a - b)).toEqual(found)
  })

  it('puts a chop just before each hit', () => {
    for (const t of hits) {
      const nearest = found.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best))
      expect(nearest).toBeLessThanOrEqual(t)
      expect(t - nearest).toBeLessThan(0.04)
    }
  })

  it('still fills every pad when there is nothing to find', () => {
    const silent = detectOnsets(buffer(new Float32Array(10 * SR)), 0, 10, 12)
    expect(silent).toHaveLength(12)
    expect(new Set(silent).size).toBe(12)
  })

  it('falls back to an even grid when the window is too short to analyse', () => {
    expect(detectOnsets(buffer(new Float32Array(SR)), 0, 0.2, 4)).toEqual(gridSlices(0, 0.2, 4))
  })
})

describe('peaks', () => {
  it('gives the lowest and highest sample of each column', () => {
    const data = Float32Array.from({ length: 400 }, (_, i) => (i < 200 ? 0.5 : -0.25))
    const out = peaks(buffer(data), 0, 400 / SR, 2)
    expect(Array.from(out).map((v) => +v.toFixed(2))).toEqual([0, 0.5, -0.25, 0])
  })

  it('reads stereo as the average of the two channels', () => {
    const left = new Float32Array(100).fill(1)
    const right = new Float32Array(100).fill(0)
    expect(peaks(buffer(left, right), 0, 100 / SR, 1)[1]).toBeCloseTo(0.5)
  })
})
