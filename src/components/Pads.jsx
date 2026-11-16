import { useEffect, useRef } from 'react'
import { engine, padName, BANK_SIZE, bankStart } from '../audio/engine.js'

export const KEYS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V']

// The sixteen pad ids of the bank on show.
export const bankPads = (bank) =>
  Array.from({ length: BANK_SIZE }, (_, i) => i + bankStart(bank))

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// The small line under a pad's name: what it will actually do when you hit it.
function meta(pad, kind, loop, s) {
  const kp = engine.kitPads[pad - BANK_SIZE]
  if (kind === 'loop') return loop === 'on' ? 'playing' : loop === 'queued' ? 'on the bar' : `${kp.bars} bars`
  if (kind === 'drum') return 'drum'
  if (kind === 'shot') {
    // A chop says where in the source it comes from; a phrase says how long it is.
    const isChop = /^(CHOP|PICKUP)/.test(kp.name)
    return isChop && kp.source != null ? `at ${clock(kp.source)}` : `${kp.buffer.duration.toFixed(1)} s`
  }
  if (kind === 'chop' && pad < s.slices.length) return `${(engine.sliceEnd(pad) - s.slices[pad]).toFixed(1)} s`
  return ''
}

export default function Pads({ s }) {
  const refs = useRef({})

  // Pads flash from the engine directly, so sequenced hits light up too
  // without re-rendering anything.
  useEffect(
    () =>
      engine.onHit((pad) => {
        refs.current[pad]?.animate(
          [
            { backgroundColor: 'var(--hit)', transform: 'translateY(2px)' },
            { backgroundColor: 'var(--pad)', transform: 'translateY(0)' },
          ],
          { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
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
            disabled={kind === 'empty'}
            aria-label={kind === 'empty' ? 'Empty pad' : `${padName(pad)}, key ${KEYS[i]}`}
            aria-pressed={kind === 'loop' ? Boolean(loop) : undefined}
          >
            <span className="pad-top">
              <kbd className="pad-key">{KEYS[i]}</kbd>
              {used && <span className="pad-led" title="Has steps in the pattern" />}
            </span>
            <span className="pad-label">
              <span className="pad-name">{padName(pad)}</span>
              <span className="pad-meta">{meta(pad, kind, loop, s)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
