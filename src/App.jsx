import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { engine } from './audio/engine.js'
import Screen from './components/Screen.jsx'
import Pads, { KEYS } from './components/Pads.jsx'
import Knob from './components/Knob.jsx'
import Sequencer from './components/Sequencer.jsx'

const KEY_CODES = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'KeyQ', 'KeyW', 'KeyE', 'KeyR',
  'KeyA', 'KeyS', 'KeyD', 'KeyF',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV',
]

const pct = (v) => `${Math.round(v * 100)}%`

export default function App() {
  const s = useSyncExternalStore(engine.subscribe, engine.getState)
  const fileInput = useRef(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    engine.boot()
  }, [])

  useEffect(() => {
    const typing = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
    const down = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return
      if (e.code === 'Space') {
        e.preventDefault()
        engine.togglePlay()
        return
      }
      const pad = KEY_CODES.indexOf(e.code)
      if (pad >= 0) engine.trigger(pad)
    }
    const up = (e) => {
      const pad = KEY_CODES.indexOf(e.code)
      if (pad >= 0) engine.release(pad)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const drop = (e) => {
    e.preventDefault()
    setDropping(false)
    const file = e.dataTransfer.files?.[0]
    if (file) engine.loadFile(file)
  }

  return (
    <div
      className="stage"
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={drop}
    >
      <header className="mast">
        <h1>
          <span className="mast-model">WIRE-2004</span>
          <span className="mast-sub">chipmunk soul sampler</span>
        </h1>
        <p>One song, twelve chops, four drums. Built around Kanye West's “Through the Wire”.</p>
      </header>

      <main className="unit">
        <section className="deck">
          <Screen s={s} />

          <div className="strip">
            <div className="transport">
              <button className={`btn btn-play${s.playing ? ' is-on' : ''}`} onClick={() => engine.togglePlay()}>
                {s.playing ? 'STOP' : 'PLAY'}
                <kbd>SPACE</kbd>
              </button>
              <button
                className={`btn btn-rec${s.rec ? ' is-on' : ''}`}
                onClick={() => engine.set({ rec: !s.rec, message: s.rec ? 'RECORD OFF' : 'RECORD ARMED. PRESS PLAY AND HIT PADS' })}
                aria-pressed={s.rec}
              >
                REC
              </button>
              <button className="btn" onClick={(e) => (e.shiftKey ? engine.clearAll() : engine.clearPad(s.selected))} title="Shift-click to erase every pad">
                CLEAR
              </button>
              <div className="tempo">
                <button className="btn btn-small" onClick={() => engine.setBpm(s.bpm - 1)} aria-label="Slower">−</button>
                <span className="tempo-read">{s.bpm}<small>BPM</small></span>
                <button className="btn btn-small" onClick={() => engine.setBpm(s.bpm + 1)} aria-label="Faster">+</button>
                <button className="btn btn-small" onClick={() => engine.tap()}>TAP</button>
              </div>
            </div>

            <div className="knobs">
              <Knob label="PITCH" value={s.pitch} min={-12} max={12} step={1} reset={0}
                onChange={(v) => engine.setPitch(v)} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`} />
              <Knob label="TONE" value={s.tone} min={0} max={1} reset={1}
                onChange={(v) => engine.setTone(v)} format={pct} />
              <Knob label="SWING" value={s.swing} min={0} max={0.6} reset={0.18}
                onChange={(v) => engine.setSwing(v)} format={(v) => pct(v / 0.6)} />
              <Knob label="VOLUME" value={s.volume} min={0} max={1} reset={0.8}
                onChange={(v) => engine.setVolume(v)} format={pct} />
            </div>
          </div>

          <Sequencer s={s} />
        </section>

        <section className="deck deck-pads">
          <div className="modes">
            <div className="mode-group">
              <span className="mode-label">CHOP</span>
              <button className={`btn${s.sliceMode === 'auto' ? ' is-on' : ''}`} onClick={() => engine.reslice('auto')}>AUTO</button>
              <button className={`btn${s.sliceMode === 'grid' ? ' is-on' : ''}`} onClick={() => engine.reslice('grid')}>GRID</button>
            </div>
            <div className="mode-group">
              <span className="mode-label">PLAY</span>
              <button className={`btn${s.choke ? ' is-on' : ''}`} onClick={() => engine.set({ choke: !s.choke, message: s.choke ? 'CHOPS OVERLAP' : 'CHOPS CUT EACH OTHER OFF' })} aria-pressed={s.choke}>CHOKE</button>
              <button className={`btn${s.gate ? ' is-on' : ''}`} onClick={() => engine.set({ gate: !s.gate, message: s.gate ? 'CHOPS PLAY TO THE END' : 'CHOPS STOP WHEN YOU LET GO' })} aria-pressed={s.gate}>GATE</button>
            </div>
          </div>

          <Pads s={s} />

          <div className="source">
            <button className="btn" onClick={() => fileInput.current.click()}>LOAD YOUR FILE</button>
            {s.source.kind === 'file' && (
              <button className="btn" onClick={() => engine.usePreview()}>BACK TO PREVIEW</button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                if (e.target.files[0]) engine.loadFile(e.target.files[0])
                e.target.value = ''
              }}
            />
            <p>
              Plays Apple's official 30-second preview out of the box. Own the song? Drop your file
              anywhere on this page to chop the whole thing. It stays in your browser.
            </p>
          </div>
        </section>
      </main>

      <footer className="liner">
        <div>
          <h2>How to play</h2>
          <ul>
            <li><b>{KEYS.slice(0, 12).join(' ')}</b> fire the chops, <b>Z X C V</b> are kick, snare, hat and open hat.</li>
            <li>Drag a marker on the screen to move a chop. Click the thin strip above it to chop a different part of the song.</li>
            <li>Turn <b>PITCH</b> up to speed the sample into chipmunk soul. Double-click any knob to reset it.</li>
            <li>Arm <b>REC</b>, press play, and your pad hits are written into the pattern.</li>
          </ul>
        </div>
        <div>
          <h2>Liner notes</h2>
          <p>
            In October 2002 Kanye West fell asleep at the wheel in Los Angeles and shattered his jaw.
            Two weeks later, with it still wired shut, he recorded this song over a sped-up chop of
            Chaka Khan's “Through the Fire”. It became his debut single and opened the door to
            The College Dropout in 2004. This machine lets you do to his record what he did to hers.
          </p>
        </div>
      </footer>

      {dropping && <div className="dropzone">DROP THE TRACK</div>}
    </div>
  )
}
