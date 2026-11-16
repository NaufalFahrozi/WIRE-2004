import { engine, padName, STEPS } from '../audio/engine.js'
import { bankPads } from './Pads.jsx'

export default function Sequencer({ s }) {
  const row = s.pattern[s.selected]
  const isLoop = engine.kindOf(s.selected) === 'loop'
  const rows = bankPads(s.bank).filter((pad) => !['loop', 'empty'].includes(engine.kindOf(pad)))

  return (
    <div className="seq">
      <div className="seq-head">
        <span className="seq-title">STEPS · {padName(s.selected)}</span>
        <span className="seq-hint">one bar, sixteen steps</span>
      </div>

      {isLoop ? (
        <p className="seq-note">
          Loops run on their own and come in on the bar line. Pick a sample or a drum to write steps for it.
        </p>
      ) : (
        <div className="steps">
          {row.map((on, i) => (
            <button
              key={i}
              className={`step${on ? ' step-on' : ''}${s.step === i ? ' step-now' : ''}${i % 4 === 0 ? ' step-beat' : ''}`}
              onClick={() => engine.toggleStep(s.selected, i)}
              aria-pressed={on}
              aria-label={`Step ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <div
        className="map"
        style={{ gridTemplateRows: `repeat(${Math.ceil(rows.length / 2)}, auto)` }}
        aria-label="Pattern overview. Click a row to edit that pad."
      >
        {rows.map((pad) => (
          <button
            key={pad}
            className={`map-row${pad === s.selected ? ' map-row-selected' : ''}`}
            onClick={() => engine.select(pad)}
            aria-label={`Edit ${padName(pad)}`}
          >
            <span className="map-name">{padName(pad)}</span>
            <span className="map-cells">
              {Array.from({ length: STEPS }, (_, i) => (
                <i key={i} className={`${s.pattern[pad][i] ? 'on' : ''}${s.step === i ? ' now' : ''}`} />
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
