// WIRE-2004 audio engine.
//
// Four banks of sixteen pads share one clock:
//   Bank A, "the beat":  the chorus rebuilt. Four loops that stack in sync (the
//           drums and bass that were added, the sample, and the finished
//           record to compare against), the sample line by line, and four
//           drum hits.
//   Banks B and C, "the chops": the sample chop by chop, cut from the source
//           record, in the order they come.
//   Bank D, "chop it":   twelve chops you place yourself anywhere in the song,
//           on any stem, plus the same four drum hits.
//
// Pad ids: 0-15 are bank D, 16 and up are the kit's pads (banks A, B, C).

import { detectOnsets, gridSlices, peaks } from './slicer.js'
import { playDrum, DRUMS } from './drums.js'

export const N_CHOPS = 12
export const BANK_SIZE = 16
export const N_PADS = BANK_SIZE * 4
export const bankStart = (bank) => ({ A: BANK_SIZE, B: BANK_SIZE * 2, C: BANK_SIZE * 3, D: 0 })[bank]
export const FREE_BANK = 'D'
export const STEPS = 16
export const REGION_SECONDS = 24

// Apple's catalogue id for "Through the Wire" (Kanye West, The College Dropout).
// Only used when no kit has been built: the app then streams Apple's preview.
const TRACK_ID = 1437467903
const SETTINGS_KEY = 'wire2004.settings.v4'

const emptyPattern = () => Array.from({ length: N_PADS }, () => Array(STEPS).fill(false))

function starterPattern() {
  const p = emptyPattern()
  const put = (pad, steps) => steps.forEach((s) => (p[pad][s] = true))
  put(12, [0, 7, 10])
  put(13, [4, 12])
  put(14, [0, 2, 4, 6, 8, 10, 12, 14])
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
    this.loopNodes = new Map()
    this.buffer = null
    this.overview = null
    this.peakCache = new Map()
    this.kitPads = []
    this.drumBuffers = []
    this.bufferVersion = 0
    this.timer = null
    this.nextTime = 0
    this.nextStep = 0
    this.barCount = 0
    this.skip = new Set()
    this.taps = []
    this.saveTimer = null

    this.state = {
      loading: false,
      message: 'POWER ON',
      source: { kind: 'none', name: '', duration: 0 },
      kit: null,
      bank: FREE_BANK,
      stem: 'full',
      loops: {},
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
      pattern: emptyPattern(),
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

  // ---- pads ----------------------------------------------------------------

  kindOf(pad) {
    if (pad >= BANK_SIZE) return this.kitPads[pad - BANK_SIZE]?.kind ?? 'empty'
    return pad < N_CHOPS ? 'chop' : 'drum'
  }

  nameOf(pad) {
    if (pad >= BANK_SIZE) return this.kitPads[pad - BANK_SIZE]?.name ?? '—'
    if (pad < N_CHOPS) return `CHOP ${String(pad + 1).padStart(2, '0')}`
    return this.state.kit?.drums[pad - N_CHOPS]?.name ?? DRUMS[pad - N_CHOPS]
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
  // track, loops and phrases cut from its cleanest hook, and drum hits lifted
  // out of it. Without one (a fresh clone has no audio in it) the app falls
  // back to Apple's 30-second preview.
  async loadKit() {
    try {
      const res = await fetch('/kit/kit.json', { cache: 'no-store' })
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return false
      const kit = await res.json()
      this.set({ loading: true, message: 'LOADING THE KIT CUT FROM THE RECORD' })
      const [drums, pads] = await Promise.all([
        Promise.all(kit.drums.map((d) => this.fetchAudio(`/kit/${d.file}`))),
        Promise.all(kit.pads.map(async (p) => ({ ...p, buffer: p.file ? await this.fetchAudio(`/kit/${p.file}`) : null }))),
      ])
      this.drumBuffers = drums
      this.kitPads = pads
      const stem = kit.stems.some((x) => x.id === this.state.stem) ? this.state.stem : kit.stems[0].id
      const buffer = await this.fetchAudio(`/kit/${kit.stems.find((x) => x.id === stem).file}`)
      this.set({ kit, stem, bank: 'A', selected: BANK_SIZE, bpm: Math.round(kit.bpm), sliceMode: 'grid' })
      this.useBuffer(buffer, { kind: 'kit', name: kit.title }, 'KIT LOADED. EVERY SOUND IS FROM THE RECORD')
      return true
    } catch {
      this.drumBuffers = []
      this.kitPads = []
      return false
    }
  }

  async fetchAudio(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(url)
    return this.ensureCtx().decodeAudioData(await res.arrayBuffer())
  }

  // Swap which stem bank B's chops are cut from. Chop points stay put.
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
      const buffer = await this.ensureCtx().decodeAudioData(await res.arrayBuffer())
      // No record to take drums from here, so give the synth kit a beat.
      if (!this.state.pattern.some((row) => row.some(Boolean))) this.set({ pattern: starterPattern() })
      this.useBuffer(buffer, { kind: 'preview', name: 'OFFICIAL PREVIEW' }, 'PREVIEW LOADED. HIT A PAD')
    } catch {
      this.set({ loading: false, message: 'NO SIGNAL. CHECK YOUR CONNECTION AND RELOAD' })
    }
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

  hasBank(bank) {
    if (bank === FREE_BANK) return true
    return this.kitPads.length > bankStart(bank) - BANK_SIZE
  }

  setBank(bank) {
    if (bank === this.state.bank || !this.hasBank(bank)) return
    const message = {
      A: 'BANK A. THE BEAT, REBUILT',
      B: 'BANK B. THE CHORUS, CHOP BY CHOP',
      C: 'BANK C. THE REST OF THE CHOPS',
      D: 'BANK D. CHOP THE SONG YOURSELF',
    }[bank]
    this.set({ bank, selected: bankStart(bank), message })
  }

  // ---- bank B chops --------------------------------------------------------

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

  cachedPeaks(key, make) {
    if (!this.peakCache.has(key)) {
      if (this.peakCache.size > 40) this.peakCache.clear()
      this.peakCache.set(key, make())
    }
    return this.peakCache.get(key)
  }

  regionPeaks(cols) {
    const { region } = this.state
    if (!this.buffer) return null
    return this.cachedPeaks(`r:${region.start}:${region.len}:${cols}:${this.bufferVersion}`, () =>
      peaks(this.buffer, region.start, region.len, cols),
    )
  }

  padPeaks(pad, cols) {
    const buffer = this.kitPads[pad - BANK_SIZE]?.buffer
    if (!buffer) return null
    return this.cachedPeaks(`p:${pad}:${cols}`, () => peaks(buffer, 0, buffer.duration, cols))
  }

  // ---- playing -------------------------------------------------------------

  select(pad) {
    if (pad !== this.state.selected) this.set({ selected: pad })
  }

  trigger(pad, { time, fromSeq = false } = {}) {
    const ctx = this.ensureCtx()
    if (!fromSeq) this.wake()
    const kind = this.kindOf(pad)
    if (kind === 'empty') return

    if (kind === 'loop') {
      if (fromSeq) return
      this.select(pad)
      this.toggleLoop(pad)
      return
    }

    const t = time ?? ctx.currentTime
    if (!fromSeq) {
      const patch = {}
      if (pad !== this.state.selected) patch.selected = pad
      if (this.state.rec && this.state.playing) Object.assign(patch, this.recordHit(pad))
      if (Object.keys(patch).length) this.set(patch)
    }
    this.flash(pad, t)

    if (kind === 'drum') {
      const hit = pad >= BANK_SIZE ? this.kitPads[pad - BANK_SIZE].buffer : this.drumBuffers[pad - N_CHOPS]
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

    if (kind === 'shot') {
      const { buffer, gain } = this.kitPads[pad - BANK_SIZE]
      this.playSample(pad, buffer, 0, buffer.duration, t, fromSeq, gain ?? 1)
    } else if (this.buffer && pad < this.state.slices.length) {
      const offset = this.state.slices[pad]
      this.playSample(pad, this.buffer, offset, Math.max(0.02, this.sliceEnd(pad) - offset), t, fromSeq)
    }
  }

  playSample(pad, buffer, offset, dur, t, fromSeq, level = 1) {
    const ctx = this.ctx
    if (this.state.choke) this.stopVoices(t)
    const rate = Math.pow(2, this.state.pitch / 12)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.004)
    const end = t + dur / rate
    g.gain.setValueAtTime(level, Math.max(t + 0.004, end - 0.012))
    g.gain.linearRampToValueAtTime(0, end)
    src.connect(g).connect(this.sampleBus)
    src.start(t, offset, dur)

    const voice = { pad, src, g, t0: t, offset, dur, rate, fromSeq }
    this.voices.add(voice)
    src.onended = () => this.voices.delete(voice)
  }

  flash(pad, t) {
    const delay = Math.max(0, (t - this.ctx.currentTime) * 1000)
    if (delay < 12) this.hitListeners.forEach((fn) => fn(pad))
    else setTimeout(() => this.hitListeners.forEach((fn) => fn(pad)), delay)
  }

  release(pad) {
    const kind = this.kindOf(pad)
    if (!this.state.gate || (kind !== 'chop' && kind !== 'shot')) return
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

  // ---- loops ---------------------------------------------------------------

  // Loops wait for the next bar line, so whatever you stack stays in time.
  toggleLoop(pad) {
    const loops = { ...this.state.loops }
    if (loops[pad]) {
      this.stopLoop(pad)
      delete loops[pad]
      this.set({ loops, message: `${this.nameOf(pad)} LOOP OFF` })
      return
    }
    loops[pad] = 'queued'
    this.set({ loops, message: `${this.nameOf(pad)} LOOP COMES IN ON THE BAR` })
    if (!this.state.playing) this.play()
  }

  loopRate() {
    return this.state.bpm / this.state.kit.bpm
  }

  startLoop(pad, t) {
    const { buffer, bars } = this.kitPads[pad - BANK_SIZE]
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const rate = this.loopRate()
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(1, t + 0.003)
    src.connect(g).connect(this.sampleBus)
    // Join at the bar the song has reached, so loops started at different
    // moments still line up phrase for phrase.
    const offset = (this.barCount % bars) * (240 / this.state.kit.bpm)
    src.start(t, offset)
    this.loopNodes.set(pad, { src, g, t0: t, offset, rate })
    this.flash(pad, t)
    setTimeout(() => {
      if (this.state.loops[pad] === 'queued') this.set({ loops: { ...this.state.loops, [pad]: 'on' } })
    }, Math.max(0, (t - ctx.currentTime) * 1000))
  }

  stopLoop(pad) {
    const node = this.loopNodes.get(pad)
    if (!node) return
    const t = this.ctx.currentTime
    node.g.gain.cancelScheduledValues(t)
    node.g.gain.setTargetAtTime(0, t, 0.01)
    node.src.stop(t + 0.08)
    this.loopNodes.delete(pad)
  }

  // Where a loop's playhead is, as a fraction of its length.
  loopPosition(pad) {
    const node = this.loopNodes.get(pad)
    const buffer = this.kitPads[pad - BANK_SIZE]?.buffer
    if (!node || !buffer) return null
    const now = this.ctx.currentTime
    if (now < node.t0) return null
    return ((node.offset + (now - node.t0) * node.rate) % buffer.duration) / buffer.duration
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
    // Loops are tape: change the tempo and they speed up or slow down with it.
    if (!this.loopNodes.size) return
    const now = this.ctx.currentTime
    const rate = this.loopRate()
    for (const [pad, node] of this.loopNodes) {
      const length = this.kitPads[pad - BANK_SIZE].buffer.duration
      node.offset = (node.offset + Math.max(0, now - node.t0) * node.rate) % length
      node.t0 = Math.max(now, node.t0)
      node.rate = rate
      node.src.playbackRate.setValueAtTime(rate, now)
    }
  }

  tap() {
    const now = performance.now()
    this.taps = this.taps.filter((x) => now - x < 2500).concat(now)
    if (this.taps.length >= 3) {
      const span = (now - this.taps[0]) / (this.taps.length - 1)
      this.setBpm(60000 / span)
    }
  }

  // ---- clock and sequencer -------------------------------------------------

  get stepDur() {
    return 60 / this.state.bpm / 4
  }

  togglePlay() {
    this.state.playing ? this.stop() : this.play()
  }

  play() {
    this.wake()
    this.nextStep = 0
    this.barCount = 0
    this.nextTime = this.ctx.currentTime + 0.06
    this.skip.clear()
    this.set({ playing: true, message: 'RUNNING' })
    this.timer = setInterval(() => this.schedule(), 25)
    this.schedule()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
    this.stopVoices()
    for (const pad of [...this.loopNodes.keys()]) this.stopLoop(pad)
    this.set({ playing: false, step: -1, loops: {}, message: 'STOPPED' })
  }

  schedule() {
    const ctx = this.ctx
    while (this.nextTime < ctx.currentTime + 0.12) {
      const s = this.nextStep
      const t = this.nextTime + (s % 2 ? this.state.swing * this.stepDur * 0.5 : 0)
      if (s === 0) {
        for (const [pad, status] of Object.entries(this.state.loops)) {
          if (status === 'queued' && !this.loopNodes.has(+pad)) this.startLoop(+pad, t)
        }
        this.barCount++
      }
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
    this.set({ pattern, message: `${this.nameOf(pad)} CLEARED` })
  }

  clearAll() {
    this.set({ pattern: emptyPattern(), message: 'PATTERN ERASED' })
  }
}

export const engine = new Engine()
export const padName = (pad) => engine.nameOf(pad)
if (import.meta.env.DEV) window.__wire = engine
