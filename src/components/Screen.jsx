import { useEffect, useRef } from 'react'
import { engine, padName, N_CHOPS, BANK_SIZE } from '../audio/engine.js'

const AMBER = '#ffb62e'
const AMBER_DIM = 'rgba(255, 182, 46, 0.34)'
const AMBER_FAINT = 'rgba(255, 182, 46, 0.1)'

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const g = canvas.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { g, w, h }
}

function drawWave(canvas, spectrum) {
  const { g, w, h } = fit(canvas)
  const s = engine.getState()
  const { region, slices, selected } = s
  g.clearRect(0, 0, w, h)
  const x = (t) => ((t - region.start) / region.len) * w

  // Live spectrum, drawn behind the waveform.
  if (engine.analyser) {
    engine.analyser.getByteFrequencyData(spectrum)
    const bars = 40
    const bw = w / bars
    g.fillStyle = AMBER_FAINT
    for (let i = 0; i < bars; i++) {
      const v = spectrum[Math.floor(Math.pow(i / bars, 1.6) * 90)] / 255
      const bh = Math.round((v * h * 0.9) / 6) * 6
      g.fillRect(i * bw + 1, h - bh, bw - 2, bh)
    }
  }

  if (s.bank === 'A') return drawKitPad(g, w, h, s)
  if (!engine.buffer || !region.len) return

  // Selected chop gets a lit backdrop.
  if (selected < slices.length) {
    g.fillStyle = 'rgba(255, 182, 46, 0.13)'
    g.fillRect(x(slices[selected]), 0, x(engine.sliceEnd(selected)) - x(slices[selected]), h)
  }

  // The waveform, drawn as one continuous wire.
  const cols = Math.max(1, Math.floor(w))
  const data = engine.regionPeaks(cols)
  // Every other column is skipped so it reads as LCD pixels, not a solid block.
  const selA = selected < slices.length ? x(slices[selected]) : -1
  const selB = selected < slices.length ? x(engine.sliceEnd(selected)) : -1
  const top = 18
  const amp = (h - top) / 2
  const cy = top + amp
  for (const lit of [false, true]) {
    g.fillStyle = lit ? AMBER : 'rgba(255, 182, 46, 0.5)'
    for (let c = 0; c < cols; c += 2) {
      if ((c >= selA && c < selB) !== lit) continue
      const y0 = cy - data[c * 2 + 1] * amp * 0.94
      const y1 = cy - data[c * 2] * amp * 0.94
      g.fillRect(c, y0, 1, Math.max(1, y1 - y0))
    }
  }

  // Chop markers: a dark cut through the wave with a numbered tab on top.
  g.font = '16px VT323, monospace'
  g.textBaseline = 'top'
  slices.forEach((t, i) => {
    const px = Math.round(x(t))
    g.fillStyle = '#1a1204'
    g.fillRect(px - 1, top, 3, h - top)
    g.fillStyle = i === selected ? '#fff3d6' : AMBER
    g.fillRect(px, 0, 1, h)
    g.fillRect(px, 0, 17, 15)
    g.fillStyle = '#1a1204'
    g.fillText(String(i + 1).padStart(2, '0'), px + 2, 0)
  })

  // Playheads for every sounding voice.
  const now = engine.ctx.currentTime
  g.fillStyle = '#fff3d6'
  for (const v of engine.voices) {
    const played = (now - v.t0) * v.rate
    if (played < 0 || played > v.dur) continue
    g.fillRect(Math.round(x(v.offset + played)), 0, 2, h)
  }
}

// Bank A: the selected pad's own sound, with bar lines on the loops.
function drawKitPad(g, w, h, s) {
  const pad = s.selected
  const kp = engine.kitPads[pad - BANK_SIZE]
  const cols = Math.max(1, Math.floor(w))
  const data = engine.padPeaks(pad, cols)
  if (!kp || !data) return
  const top = 18
  const amp = (h - top) / 2
  const cy = top + amp
  // Quiet stems are drawn at full height so their shape is still readable.
  let peak = 0.05
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
  g.fillStyle = AMBER
  for (let c = 0; c < cols; c += 2) {
    const y0 = cy - (data[c * 2 + 1] / peak) * amp * 0.94
    const y1 = cy - (data[c * 2] / peak) * amp * 0.94
    g.fillRect(c, y0, 1, Math.max(1, y1 - y0))
  }

  if (kp.kind === 'loop') {
    g.font = '16px VT323, monospace'
    g.textBaseline = 'top'
    for (let b = 0; b < kp.bars; b++) {
      const px = Math.round((b / kp.bars) * w)
      g.fillStyle = '#1a1204'
      g.fillRect(px - 1, top, 3, h - top)
      g.fillStyle = AMBER
      g.fillRect(px, 0, 1, h)
      g.fillRect(px, 0, 11, 15)
      g.fillStyle = '#1a1204'
      g.fillText(String(b + 1), px + 2, 0)
    }
  }

  g.fillStyle = '#fff3d6'
  const loopAt = engine.loopPosition(pad)
  if (loopAt != null) g.fillRect(Math.round(loopAt * w), 0, 2, h)
  const now = engine.ctx.currentTime
  for (const v of engine.voices) {
    if (v.pad !== pad) continue
    const played = (now - v.t0) * v.rate
    if (played < 0 || played > v.dur) continue
    g.fillRect(Math.round((played / kp.buffer.duration) * w), 0, 2, h)
  }
}

function drawOverview(canvas) {
  const { g, w, h } = fit(canvas)
  const { region, source } = engine.getState()
  g.clearRect(0, 0, w, h)
  const data = engine.overview
  if (!data || !source.duration) return
  const cols = data.length / 2
  const mid = h / 2
  g.fillStyle = AMBER_DIM
  for (let px = 0; px < w; px += 2) {
    const c = Math.min(cols - 1, Math.floor((px / w) * cols))
    const amp = Math.max(1, (data[c * 2 + 1] - data[c * 2]) * mid * 0.9)
    g.fillRect(px, mid - amp / 2, 1, amp)
  }
  const rx = (region.start / source.duration) * w
  const rw = Math.max(6, (region.len / source.duration) * w)
  g.fillStyle = 'rgba(255, 182, 46, 0.2)'
  g.fillRect(rx, 0, rw, h)
  g.strokeStyle = AMBER
  g.strokeRect(rx + 0.5, 0.5, rw - 1, h - 1)
}

export default function Screen({ s }) {
  const wave = useRef(null)
  const over = useRef(null)
  const drag = useRef(null)

  useEffect(() => {
    const spectrum = new Uint8Array(128)
    let raf
    const loop = () => {
      if (wave.current) drawWave(wave.current, spectrum)
      if (over.current) drawOverview(over.current)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const timeAt = (e) => {
    const box = wave.current.getBoundingClientRect()
    const { region } = engine.getState()
    return { t: region.start + ((e.clientX - box.left) / box.width) * region.len, pxPerSec: box.width / region.len }
  }

  const waveDown = (e) => {
    const { slices, bank, selected } = engine.getState()
    if (bank === 'A') {
      if (engine.kindOf(selected) !== 'loop') {
        engine.trigger(selected)
        drag.current = { pad: selected }
      }
      return
    }
    if (!slices.length) return
    const { t, pxPerSec } = timeAt(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    const near = slices.findIndex((m) => Math.abs(m - t) * pxPerSec < 7)
    if (near >= 0) {
      engine.select(near)
      drag.current = { marker: near }
      return
    }
    let pad = 0
    slices.forEach((m, i) => t >= m && (pad = i))
    engine.trigger(pad)
    drag.current = { pad }
  }
  const waveMove = (e) => {
    if (drag.current?.marker != null) engine.moveSlice(drag.current.marker, timeAt(e).t)
  }
  const waveUp = () => {
    if (drag.current?.pad != null) engine.release(drag.current.pad)
    drag.current = null
  }

  const seek = (e) => {
    if (!s.source.duration) return
    if (e.type === 'pointermove' && !e.buttons) return
    const box = over.current.getBoundingClientRect()
    const t = ((e.clientX - box.left) / box.width) * s.source.duration
    engine.setRegionStart(t - s.region.len / 2)
  }

  const kp = s.bank === 'A' ? engine.kitPads[s.selected - BANK_SIZE] : null
  const kitInfo = !kp ? ''
    : kp.kind === 'loop' ? `LOOP · ${kp.bars} BARS`
    : kp.kind === 'shot' ? `SAMPLE · ${kp.buffer.duration.toFixed(2)}S`
    : 'DRUM · CUT FROM THE RECORD'
  const sourceTag = kp ? 'BANK A · THE BEAT' :
    s.source.kind === 'preview' ? `PREVIEW ${clock(s.source.duration)}`
    : s.source.kind === 'kit' ? `${s.kit.stems.find((x) => x.id === s.stem).label} ${clock(s.source.duration)}`
    : 'NO SOURCE'
  const chop = s.selected < N_CHOPS && s.slices.length
  const selInfo = chop
    ? `${clock(s.slices[s.selected])} · ${(engine.sliceEnd(s.selected) - s.slices[s.selected]).toFixed(2)}S`
    : s.kit ? 'CUT FROM THE RECORD' : 'SYNTH'

  return (
    <div className="screen">
      <div className="lcd">
        <div className="lcd-row lcd-title">
          <span>THROUGH THE WIRE</span>
          <span>{sourceTag}</span>
        </div>
        <div className="lcd-row lcd-dim">
          <span>KANYE WEST · THE COLLEGE DROPOUT</span>
          <span>{s.bpm} BPM · {s.pitch > 0 ? '+' : ''}{s.pitch} ST</span>
        </div>
        {s.bank === 'B' && <canvas
          ref={over}
          className="lcd-overview"
          onPointerDown={seek}
          onPointerMove={seek}
          aria-label="Whole track. Click to move the chop window."
        />}
        <canvas
          ref={wave}
          className="lcd-wave"
          onPointerDown={waveDown}
          onPointerMove={waveMove}
          onPointerUp={waveUp}
          onPointerCancel={waveUp}
          aria-label="Chop window. Drag a marker to move a chop, click a chop to hear it."
        />
        <div className="lcd-row">
          <span>{padName(s.selected)} · {kp ? kitInfo : selInfo}</span>
          <span className={s.loading ? 'lcd-blink' : ''}>{s.message}</span>
        </div>
      </div>
    </div>
  )
}
