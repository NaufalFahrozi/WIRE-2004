// WIRE-2004 audio engine: one track, twelve chops, four drums, sixteen steps.

import { detectOnsets, gridSlices, peaks } from './slicer.js'
import { playDrum, DRUMS } from './drums.js'

export const N_CHOPS = 12
export const N_PADS = 16
export const STEPS = 16
export const REGION_SECONDS = 24

// Apple's catalogue id for "Through the Wire" (Kanye West, The College Dropout).
// The app asks Apple for the current preview address at runtime and streams it;
// no audio is bundled with this project.
const TRACK_ID = 1437467903
const SETTINGS_KEY = 'wire2004.settings'

const emptyPattern = () => Array.from({ length: N_PADS }, () => Array(STEPS).fill(false))

function starterPattern() {
  const p = emptyPattern()
  const put = (pad, steps) => steps.forEach((s) => (p[pad][s] = true))
  put(12, [0, 7, 10])
  put(13, [4, 12])
  put(14, [0, 2, 4, 6, 8, 10, 12, 14])
  put(0, [0])
  put(1, [8])
  return p
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY))
    if (raw && Array.isArray(raw.pattern) && raw.pattern.length === N_PADS) return raw
  } catch {}
  return {}
}

class Engine {
  constructor() {
    this.listeners = new Set()
    this.hitListeners = new Set()
    this.voices = new Set()
    this.buffer = null
    this.overview = null
    this.peakCache = { key: '', data: null }
    this.timer = null
    this.nextTime = 0
    this.nextStep = 0
    this.skip = new Set()
    this.taps = []
    this.saveTimer = null
    this.drumBuffers = []
    this.bufferVersion = 0

    this.state = {
      loading: false,
      message: 'POWER ON',
      source: { kind: 'none', name: '', duration: 0 },
      kit: null,
      stem: 'full',
      region: { start: 0, len: 0 },
      slices: [],
      sliceMode: 'auto',
      selected: 0,
      pitch: 0,
      tone: 1,
      volume: 0.8,
      swing: 0.18,
      bpm: 83,
      choke: true,
      gate: false,
      playing: false,
      rec: false,
      step: -1,
      pattern: starterPattern(),
      ...loadSettings(),
    }
  }

  // ---- store ---------------------------------------------------------------

  subscribe = (fn) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getState = () => this.state

  set(patch) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.persist(), 400)
  }

  persist() {
    const { pattern, pitch, tone, volume, swing, bpm, choke, gate, sliceMode, stem } = this.state
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ pattern, pitch, tone, volume, swing, bpm, choke, gate, sliceMode, stem }),
      )
    } catch {}
  }

  onHit(fn) {
    this.hitListeners.add(fn)
    return () => this.hitListeners.delete(fn)
  }

  // ---- audio graph ---------------------------------------------------------

  ensureCtx() {
    if (this.ctx) return this.ctx
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = (this.ctx = new Ctx({ latencyHint: 'interactive' }))

    this.master = ctx.createGain()
    this.master.gain.value = this.state.volume
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -10
    comp.ratio.value = 3
    comp.attack.value = 0.004
    comp.release.value = 0.18
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.78
    this.master.connect(comp).connect(this.analyser).connect(ctx.destination)

    this.toneFilter = ctx.createBiquadFilter()
    this.toneFilter.type = 'lowpass'
    this.toneFilter.Q.value = 0.6
    this.toneFilter.frequency.value = this.toneHz(this.state.tone)
    this.sampleBus = ctx.createGain()
    this.sampleBus.gain.value = 0.9
    this.sampleBus.connect(this.toneFilter).connect(this.master)

    this.drumBus = ctx.createGain()
    this.drumBus.gain.value = 0.8
    this.drumBus.connect(this.master)
    return ctx
  }

  wake() {
    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') ctx.resume()
  }

  toneHz(v) {
    return 280 * Math.pow(20000 / 280, v)
  }

  // ---- loading -------------------------------------------------------------

  async boot() {
    if (this.booted) return
    this.booted = true
    this.ensureCtx()
    if (await this.loadKit()) return
    await this.loadPreview()
  }

  // The kit is what tools/build_kit.py makes from the record: stems of the
  // track plus drum hits lifted out of it. Without one (a fresh clone has no
  // audio in it) the app falls back to Apple's 30-second preview.
  async loadKit() {
    try {
      const res = await fetch('/kit/kit.json', { cache: 'no-store' })
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return false
      const kit = await res.json()
      this.set({ loading: true, message: 'LOADING THE KIT CUT FROM THE RECORD' })
      this.drumBuffers = await Promise.all(kit.drums.map((d) => this.fetchAudio(`/kit/${d.file}`)))
      const stem = kit.stems.some((x) => x.id === this.state.stem) ? this.state.stem : kit.stems[0].id
      const buffer = await this.fetchAudio(`/kit/${kit.stems.find((x) => x.id === stem).file}`)
      this.set({ kit, stem, bpm: Math.round(kit.bpm), sliceMode: 'grid' })
      this.useBuffer(buffer, { kind: 'kit', name: kit.title }, 'KIT LOADED. EVERY SOUND IS FROM THE RECORD')
      return true
    } catch {
      this.drumBuffers = []
      return false
    }
  }

  async fetchAudio(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(url)
    return this.ensureCtx().decodeAudioData(await res.arrayBuffer())
  }

  // Swap which stem the chops are cut from. Chop points stay where they are.
  async setStem(id) {
    const { kit } = this.state
    const stem = kit?.stems.find((x) => x.id === id)
    if (!stem || this.state.loading) return
    this.set({ loading: true, message: `LOADING ${stem.label}` })
    try {
      const buffer = await this.fetchAudio(`/kit/${stem.file}`)
      this.stopVoices()
      this.buffer = buffer
      this.bufferVersion++
      this.overview = peaks(buffer, 0, buffer.duration, 480)
      this.set({ loading: false, stem: id, message: `CHOPPING ${stem.label}` })
    } catch {
      this.set({ loading: false, message: 'COULD NOT LOAD THAT STEM' })
    }
  }

  async loadPreview() {
    this.set({ loading: true, message: 'DIALING APPLE MUSIC PREVIEW' })
    try {
      const lookup = await fetch(`https://itunes.apple.com/lookup?id=${TRACK_ID}`)
      const url = (await lookup.json()).results?.[0]?.previewUrl
      if (!url) throw new Error('no preview')
      const res = await fetch(url)
      if (!res.ok) throw new Error('preview unavailable')
      await this.decode(await res.arrayBuffer(), { kind: 'preview', name: 'OFFICIAL PREVIEW' })
    } catch {
      this.set({ loading: false, message: 'NO SIGNAL. CHECK YOUR CONNECTION AND RELOAD' })
    }
  }

  async decode(arrayBuffer, meta) {
    const buffer = await this.ensureCtx().decodeAudioData(arrayBuffer)
    this.useBuffer(buffer, meta, 'PREVIEW LOADED. HIT A PAD')
  }

  useBuffer(buffer, meta, message) {
    this.stopVoices()
    this.buffer = buffer
    this.bufferVersion++
    this.overview = peaks(buffer, 0, buffer.duration, 480)
    const { kit } = this.state
    // With a kit the window is six bars on the beat, so every chop is two beats.
    const len = Math.min(buffer.duration, kit ? (24 * 60) / kit.bpm : REGION_SECONDS)
    const region = { start: kit ? kit.start ?? kit.firstBeat : 0, len }
    this.set({
      loading: false,
      source: { ...meta, duration: buffer.duration },
      region,
      slices: this.makeSlices(region, this.state.sliceMode),
      message,
    })
  }

  // Nearest bar line that keeps the window inside the song, when the kit
  // knows where the beats are.
  snapToBar(t, len) {
    const { kit } = this.state
    if (!kit) return t
    const bar = (4 * 60) / kit.bpm
    let k = Math.round((t - kit.firstBeat) / bar)
    while (kit.firstBeat + k * bar < 0) k++
    while (k > 0 && kit.firstBeat + k * bar + len > this.buffer.duration) k--
    return kit.firstBeat + k * bar
  }

  // ---- chops ---------------------------------------------------------------

  makeSlices(region, mode) {
    if (!this.buffer) return []
    return mode === 'grid'
      ? gridSlices(region.start, region.len, N_CHOPS)
      : detectOnsets(this.buffer, region.start, region.len, N_CHOPS)
  }

  reslice(mode) {
    this.set({
      sliceMode: mode,
      slices: this.makeSlices(this.state.region, mode),
      message: mode === 'grid' ? 'CHOPPED ON AN EVEN GRID' : 'CHOPPED ON THE TRANSIENTS',
    })
  }

  setRegionStart(start) {
    if (!this.buffer) return
    const len = this.state.region.len
    const region = { start: Math.max(0, Math.min(this.buffer.duration - len, this.snapToBar(start, len))), len }
    this.set({ region, slices: this.makeSlices(region, this.state.sliceMode) })
  }

  moveSlice(i, t) {
    const { slices, region } = this.state
    const lo = i === 0 ? region.start : slices[i - 1] + 0.03
    const hi = (i + 1 < slices.length ? slices[i + 1] : region.start + region.len) - 0.03
    const next = slices.slice()
    next[i] = Math.max(lo, Math.min(hi, t))
    this.set({ slices: next })
  }

  sliceEnd(i) {
    const { slices, region } = this.state
    return i + 1 < slices.length ? slices[i + 1] : region.start + region.len
  }

  regionPeaks(cols) {
    const { region } = this.state
    const key = `${region.start}:${region.len}:${cols}:${this.bufferVersion}`
    if (this.peakCache.key !== key) {
      this.peakCache = { key, data: this.buffer ? peaks(this.buffer, region.start, region.len, cols) : null }
    }
    return this.peakCache.data
  }

  // ---- playing -------------------------------------------------------------

  select(pad) {
    if (pad !== this.state.selected) this.set({ selected: pad })
  }

  trigger(pad, { time, fromSeq = false } = {}) {
    const ctx = this.ensureCtx()
    if (!fromSeq) this.wake()
    const t = time ?? ctx.currentTime

    if (!fromSeq) {
      const patch = {}
      if (pad !== this.state.selected) patch.selected = pad
      if (this.state.rec && this.state.playing) Object.assign(patch, this.recordHit(pad))
      if (Object.keys(patch).length) this.set(patch)
    }

    const delay = Math.max(0, (t - ctx.currentTime) * 1000)
    if (delay < 12) this.hitListeners.forEach((fn) => fn(pad))
    else setTimeout(() => this.hitListeners.forEach((fn) => fn(pad)), delay)

    if (pad >= N_CHOPS) {
      const hit = this.drumBuffers[pad - N_CHOPS]
      if (hit) {
        const src = ctx.createBufferSource()
        src.buffer = hit
        src.connect(this.drumBus)
        src.start(t)
      } else {
        playDrum(ctx, this.drumBus, pad - N_CHOPS, t)
      }
      return
    }
    if (!this.buffer || pad >= this.state.slices.length) return

    if (this.state.choke) this.stopVoices(t)
    const offset = this.state.slices[pad]
    const dur = Math.max(0.02, this.sliceEnd(pad) - offset)
    const rate = Math.pow(2, this.state.pitch / 12)

    const src = ctx.createBufferSource()
    src.buffer = this.buffer
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(1, t + 0.004)
    const end = t + dur / rate
    g.gain.setValueAtTime(1, Math.max(t + 0.004, end - 0.012))
    g.gain.linearRampToValueAtTime(0, end)
    src.connect(g).connect(this.sampleBus)
    src.start(t, offset, dur)

    const voice = { pad, src, g, t0: t, offset, dur, rate, fromSeq }
    this.voices.add(voice)
    src.onended = () => this.voices.delete(voice)
  }

  release(pad) {
    if (!this.state.gate || pad >= N_CHOPS) return
    for (const v of this.voices) if (v.pad === pad && !v.fromSeq) this.stopVoice(v)
  }

  stopVoice(v, t = this.ctx.currentTime) {
    try {
      v.g.gain.cancelScheduledValues(t)
      v.g.gain.setTargetAtTime(0, t, 0.006)
      v.src.stop(t + 0.04)
    } catch {}
    // Cut the playhead short on screen as well.
    v.dur = Math.min(v.dur, Math.max(0, (t - v.t0) * v.rate))
  }

  stopVoices(t) {
    if (!this.ctx) return
    for (const v of this.voices) this.stopVoice(v, t ?? this.ctx.currentTime)
  }

  // ---- knobs ---------------------------------------------------------------

  setVolume(v) {
    this.master?.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
    this.set({ volume: v })
  }
  setTone(v) {
    this.toneFilter?.frequency.setTargetAtTime(this.toneHz(v), this.ctx.currentTime, 0.02)
    this.set({ tone: v })
  }
  setPitch(v) {
    this.set({ pitch: Math.round(v) })
  }
  setSwing(v) {
    this.set({ swing: v })
  }
  setBpm(v) {
    this.set({ bpm: Math.max(50, Math.min(180, Math.round(v))) })
  }

  tap() {
    const now = performance.now()
    this.taps = this.taps.filter((x) => now - x < 2500).concat(now)
    if (this.taps.length >= 3) {
      const span = (now - this.taps[0]) / (this.taps.length - 1)
      this.setBpm(60000 / span)
    }
  }

  // ---- sequencer -----------------------------------------------------------

  get stepDur() {
    return 60 / this.state.bpm / 4
  }

  togglePlay() {
    this.state.playing ? this.stop() : this.play()
  }

  play() {
    this.wake()
    this.nextStep = 0
    this.nextTime = this.ctx.currentTime + 0.06
    this.skip.clear()
    this.set({ playing: true, message: 'SEQUENCE RUNNING' })
    this.timer = setInterval(() => this.schedule(), 25)
    this.schedule()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
    this.stopVoices()
    this.set({ playing: false, step: -1, message: 'STOPPED' })
  }

  schedule() {
    const ctx = this.ctx
    while (this.nextTime < ctx.currentTime + 0.12) {
      const s = this.nextStep
      const t = this.nextTime + (s % 2 ? this.state.swing * this.stepDur * 0.5 : 0)
      for (let pad = 0; pad < N_PADS; pad++) {
        if (!this.state.pattern[pad][s]) continue
        const key = `${pad}:${s}`
        if (this.skip.delete(key)) continue
        this.trigger(pad, { time: t, fromSeq: true })
      }
      setTimeout(() => this.state.playing && this.set({ step: s }), Math.max(0, (t - ctx.currentTime) * 1000))
      this.nextTime += this.stepDur
      this.nextStep = (s + 1) % STEPS
    }
  }

  // Snap a live hit to the nearest step and write it into the pattern.
  recordHit(pad) {
    const now = this.ctx.currentTime
    let best = null
    for (let k = 0; k < 3; k++) {
      const time = this.nextTime - k * this.stepDur
      const step = (this.nextStep - k + STEPS * 2) % STEPS
      const dist = Math.abs(time - now)
      if (!best || dist < best.dist) best = { step, dist, upcoming: k === 0 }
    }
    // The pad was just played by hand; do not let the sequencer double it.
    if (best.upcoming) this.skip.add(`${pad}:${best.step}`)
    const pattern = this.state.pattern.map((row) => row.slice())
    pattern[pad][best.step] = true
    return { pattern }
  }

  toggleStep(pad, step) {
    const pattern = this.state.pattern.map((row) => row.slice())
    pattern[pad][step] = !pattern[pad][step]
    this.set({ pattern })
  }

  clearPad(pad) {
    const pattern = this.state.pattern.map((row) => row.slice())
    pattern[pad] = Array(STEPS).fill(false)
    this.set({ pattern, message: `${padName(pad)} CLEARED` })
  }

  clearAll() {
    this.set({ pattern: emptyPattern(), message: 'PATTERN ERASED' })
  }
}

export function padName(pad) {
  if (pad < N_CHOPS) return `CHOP ${String(pad + 1).padStart(2, '0')}`
  return engine.state.kit?.drums[pad - N_CHOPS]?.name ?? DRUMS[pad - N_CHOPS]
}

export const engine = new Engine()
if (import.meta.env.DEV) window.__wire = engine
