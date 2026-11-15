import { useEffect, useRef } from 'react'
import { engine, padName, N_CHOPS, N_PADS } from '../audio/engine.js'

export const KEYS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V']

export default function Pads({ s }) {
  const refs = useRef([])

  // Pads flash from the engine directly, so sequenced hits light up too
  // without re-rendering anything.
  useEffect(
    () =>
      engine.onHit((pad) => {
        refs.current[pad]?.animate(
          [
            { backgroundColor: 'var(--hit)', boxShadow: '0 0 0 2px var(--hit), 0 0 26px var(--hit)', transform: 'translateY(2px)' },
            { backgroundColor: 'var(--pad)', boxShadow: '0 0 0 0 transparent', transform: 'translateY(0)' },
          ],
          { duration: 260, easing: 'ease-out' },
        )
      }),
    [],
  )

  return (
    <div className="pads">
      {Array.from({ length: N_PADS }, (_, i) => {
        const drum = i >= N_CHOPS
        const used = s.pattern[i].some(Boolean)
        return (
          <button
            key={i}
            ref={(el) => (refs.current[i] = el)}
            className={`pad${drum ? ' pad-drum' : ''}${s.selected === i ? ' pad-selected' : ''}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              engine.trigger(i)
            }}
            onPointerUp={() => engine.release(i)}
            onPointerCancel={() => engine.release(i)}
            aria-label={`${padName(i)}, key ${KEYS[i]}`}
          >
            <span className="pad-key">{KEYS[i]}</span>
            {used && <span className="pad-led" />}
            <span className="pad-name">{padName(i)}</span>
          </button>
        )
      })}
    </div>
  )
}
