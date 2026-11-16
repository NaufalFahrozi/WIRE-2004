import { useEffect, useSyncExternalStore } from 'react'
import { engine, FREE_BANK } from './audio/engine.js'
import Screen from './components/Screen.jsx'
import Pads, { bankPads } from './components/Pads.jsx'
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
      const key = KEY_CODES.indexOf(e.code)
      if (key >= 0) engine.trigger(bankPads(engine.getState().bank)[key])
    }
    const up = (e) => {
      const key = KEY_CODES.indexOf(e.code)
      if (key >= 0) engine.release(bankPads(engine.getState().bank)[key])
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  return (
    <div className="stage">
      <header className="mast">
        <h1>
          <span className="mast-model">WIRE-2004</span>
          <span className="mast-sub">chipmunk soul sampler</span>
        </h1>
        <p>Kanye West's “Through the Wire”, taken apart and put back in your hands.</p>
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
            {s.kit && (
              <div className="mode-group">
                <span className="mode-label">BANK</span>
                {[['A', 'THE BEAT'], ['B', 'CHOPS'], ['C', 'MORE CHOPS'], ['D', 'CHOP IT']].filter(([id]) => engine.hasBank(id)).map(([id, label]) => (
                  <button key={id} className={`btn${s.bank === id ? ' is-on' : ''}`} onClick={() => engine.setBank(id)} aria-pressed={s.bank === id}>
                    {id} · {label}
                  </button>
                ))}
              </div>
            )}
            {s.bank === FREE_BANK && (
              <div className="mode-group">
                <span className="mode-label">CHOP</span>
                <button className={`btn${s.sliceMode === 'auto' ? ' is-on' : ''}`} onClick={() => engine.reslice('auto')}>AUTO</button>
                <button className={`btn${s.sliceMode === 'grid' ? ' is-on' : ''}`} onClick={() => engine.reslice('grid')}>GRID</button>
              </div>
            )}
            <div className="mode-group">
              <span className="mode-label">PLAY</span>
              <button className={`btn${s.choke ? ' is-on' : ''}`} onClick={() => engine.set({ choke: !s.choke, message: s.choke ? 'CHOPS OVERLAP' : 'CHOPS CUT EACH OTHER OFF' })} aria-pressed={s.choke}>CHOKE</button>
              <button className={`btn${s.gate ? ' is-on' : ''}`} onClick={() => engine.set({ gate: !s.gate, message: s.gate ? 'CHOPS PLAY TO THE END' : 'CHOPS STOP WHEN YOU LET GO' })} aria-pressed={s.gate}>GATE</button>
            </div>
          </div>

          <Pads s={s} />

          {s.kit && s.bank === FREE_BANK && (
            <div className="mode-group stems">
              <span className="mode-label">STEM</span>
              {s.kit.stems.map((stem) => (
                <button
                  key={stem.id}
                  className={`btn${s.stem === stem.id ? ' is-on' : ''}`}
                  onClick={() => engine.setStem(stem.id)}
                  aria-pressed={s.stem === stem.id}
                >
                  {stem.label}
                </button>
              ))}
            </div>
          )}

          <div className="source">
            <p>
              {!s.kit
                ? "Running on Apple's official 30-second preview, with synthesized drums standing in for the record's own."
                : s.bank === FREE_BANK
                  ? 'Twelve chops you place yourself, anywhere in the song, cut from the full mix or from any single stem.'
                  : !s.kit.sample
                    ? 'The hook of the record, pulled apart. Top row: its drums, bass, music and vocal as loops that stack in time. Middle rows: the sample, one bar per pad. Bottom row: single drum hits.'
                    : s.bank === 'A'
                      ? `The chorus, rebuilt from its parts. Top row: the drums and the bass that were added, the sample itself (all ${s.kit.sample.bars} bars, cut clean from ${s.kit.sample.artist}'s “${s.kit.sample.title}” and sped up ${s.kit.sample.rate.toFixed(2)}x), and the finished record to compare against. Middle rows: the sample phrase by phrase, cut where the singer breathes rather than on the bar lines: the lead-in, the five lines of the chorus, the one bar of music the verses loop, and the sung phrase the verses loop. Bottom row: single drum hits.`
                      : s.bank === 'B'
                        ? `The chorus as it sat on the pads, from its pickup on: ${s.kit.sample.chop_beats} beats a pad, straight off “${s.kit.sample.title}”. Play them in order and you have the record. Play them out of order and you have something new.`
                        : 'The rest of the chops: the end of the chorus, then the stretch of the source that the verses are looped from.'}
            </p>
          </div>
        </section>
      </main>

      <footer className="liner">
        <div>
          <h2>How to play</h2>
          <ul>
            <li>Keys <b>1 2 3 4 / Q W E R / A S D F / Z X C V</b> match the pads, row by row. <b>Space</b> starts and stops the clock.</li>
            <li><b>Bank A</b> is the beat rebuilt. Tap the top row to bring a loop in on the next bar; tap again to drop it out. The sample and the record come in on their pickup, half a bar early. Drums, bass and sample together make the chorus; the record pad lets you check.</li>
            <li><b>Banks B and C</b> are the sample chop by chop, the way it sat on the pads. <b>Bank D</b> is for cutting your own.</li>
            <li>Turn <b>PITCH</b> to re-pitch the chops. Change the tempo and the loops speed up with it, like tape.</li>
            <li>Arm <b>REC</b>, press play, and your pad hits are written into the pattern. Double-click any knob to reset it.</li>
          </ul>
        </div>
        <div>
          <h2>Liner notes</h2>
          <p>
            In October 2002 Kanye West fell asleep at the wheel in Los Angeles and shattered his jaw.
            Two weeks later, with it still wired shut, he recorded this song over Chaka Khan's
            “Through the Fire”. Lining the two records up shows how the beat was made. Every bit of
            sample comes from one minute of her record, its last chorus and what follows: four
            semitones fast, in mono off the left channel, highs rolled off, cut into two-beat chops
            and re-triggered on the grid. The chorus runs straight through; the verses loop the
            bars after it. New drums and bass sit on top.
          </p>
        </div>
      </footer>

    </div>
  )
}
