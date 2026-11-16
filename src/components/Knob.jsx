import { useEffect, useRef } from 'react'

// Rotary control. Drag up or down, scroll, or use the arrow keys.
// Double-click returns it to its default.
export default function Knob({ label, value, min, max, step = 0.01, reset, onChange, format }) {
  const drag = useRef(null)
  const cap = useRef(null)
  const live = useRef({})
  live.current = { value, onChange }
  const span = max - min

  // The wheel turns the knob. It has to be a native, non-passive listener:
  // otherwise the page scrolls along with it.
  useEffect(() => {
    const el = cap.current
    const wheel = (e) => {
      e.preventDefault()
      const { value, onChange } = live.current
      onChange(Math.max(min, Math.min(max, value + (e.deltaY < 0 ? step : -step))))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [min, max, step])
  const frac = (value - min) / span
  const clamp = (v) => Math.max(min, Math.min(max, v))

  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, v: value }
  }
  const move = (e) => {
    if (!drag.current) return
    const delta = ((drag.current.y - e.clientY) / 160) * span
    onChange(clamp(drag.current.v + delta))
  }
  const up = () => (drag.current = null)
  const key = (e) => {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]
    if (!dir) return
    e.preventDefault()
    onChange(clamp(value + dir * step))
  }

  return (
    <div className="knob">
      <div
        ref={cap}
        className="knob-cap"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuetext={format(value)}
        style={{ '--turn': `${-135 + frac * 270}deg` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => onChange(reset)}
        onKeyDown={key}
      >
        <span className="knob-mark" />
      </div>
      <span className="knob-label">{label}</span>
      <span className="knob-value">{format(value)}</span>
    </div>
  )
}
