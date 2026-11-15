import { useEffect, useRef } from 'react'
import { engine, padName, BANK_SIZE } from '../audio/engine.js'

export const KEYS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V']

// The sixteen pad ids of the bank on show.
export const bankPads = (bank) =>
  Array.from({ length: BANK_SIZE }, (_, i) => i + (bank === 'A' ? BANK_SIZE : 0))

const TAGS = { loop: 'LOOP', shot: 'SAMPLE', chop: '', drum: 'DRUM' }

export default function Pads({ s }) {
  const refs = useRef({})

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
      {bankPads(s.bank).map((pad, i) => {
        const kind = engine.kindOf(pad)
        const loop = s.loops[pad]
        const used = s.pattern[pad].some(Boolean)
        return (
          <button
            key={pad}
            ref={(el) => (refs.current[pad] = el)}
            className={`pad pad-${kind}${s.selected === pad ? ' pad-selected' : ''}${loop ? ` pad-${loop}` : ''}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              engine.trigger(pad)
            }}
            onPointerUp={() => engine.release(pad)}
            onPointerCancel={() => engine.release(pad)}
            aria-label={`${padName(pad)}, key ${KEYS[i]}`}
            aria-pressed={kind === 'loop' ? Boolean(loop) : undefined}
          >
            <span className="pad-key">{KEYS[i]}</span>
            {used && <span className="pad-led" />}
            <span className="pad-name">
              {padName(pad)}
              {TAGS[kind] && <small>{kind === 'loop' && loop ? (loop === 'on' ? 'PLAYING' : 'WAITING') : TAGS[kind]}</small>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
