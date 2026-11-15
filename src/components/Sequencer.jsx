import { engine, padName, N_PADS, STEPS } from '../audio/engine.js'

export default function Sequencer({ s }) {
  const row = s.pattern[s.selected]
  return (
    <div className="seq">
      <div className="seq-head">
        <span className="seq-title">STEPS · {padName(s.selected)}</span>
        <span className="seq-hint">one bar, sixteen steps</span>
      </div>

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

      <div className="map" aria-label="Pattern overview. Click a row to edit that pad.">
        {Array.from({ length: N_PADS }, (_, pad) => (
          <button
            key={pad}
            className={`map-row${pad === s.selected ? ' map-row-selected' : ''}`}
            onClick={() => engine.select(pad)}
            aria-label={`Edit ${padName(pad)}`}
          >
            <span className="map-name">{padName(pad)}</span>
            <span className="map-cells">
              {Array.from({ length: STEPS }, (_, i) => (
                <i
                  key={i}
                  className={`${s.pattern[pad][i] ? 'on' : ''}${s.step === i ? ' now' : ''}`}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
