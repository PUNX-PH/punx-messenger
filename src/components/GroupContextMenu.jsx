import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Floating context menu rendered at a viewport position (x, y).
 * Auto-flips to stay within viewport bounds.
 *
 * Props:
 *   open:   boolean
 *   x, y:   viewport coords (e.g. from a contextmenu event)
 *   onClose: () => void
 *   items:  [{ label, icon?, onClick, danger?, separator? }, ...]
 */
export default function GroupContextMenu({ open, x, y, onClose, items = [] }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (!ref.current?.contains(e.target)) onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    const onScroll = () => onClose?.()
    window.addEventListener('mousedown', onClick)
    window.addEventListener('contextmenu', onClick)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('contextmenu', onClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, onClose])

  // After render, nudge into viewport if it overflows
  useEffect(() => {
    if (!open || !ref.current) return
    const el = ref.current
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    let nx = x, ny = y
    if (r.right > vw - 8) nx = vw - r.width - 8
    if (r.bottom > vh - 8) ny = vh - r.height - 8
    if (nx < 8) nx = 8
    if (ny < 8) ny = 8
    el.style.left = nx + 'px'
    el.style.top  = ny + 'px'
  }, [open, x, y])

  if (!open) return null

  // Render through a portal so the menu escapes any transformed/positioned
  // ancestor (the rail/drawer uses `translate-x-0`, which creates a containing
  // block and would otherwise re-anchor `position: fixed`).
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[70] min-w-[220px] bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 py-1.5 text-sm"
      style={{ top: y, left: x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-line-subtle" />
        ) : (
          <button
            key={it.label}
            role="menuitem"
            onClick={() => { it.onClick?.(); onClose?.() }}
            disabled={it.disabled}
            className={[
              'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
              it.disabled ? 'opacity-40 cursor-not-allowed'
                : it.danger ? 'text-bad hover:bg-bad/10'
                : 'text-ink hover:bg-bg-hover',
            ].join(' ')}
          >
            {it.icon && <span className="text-ink-dim w-4 grid place-items-center">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
            {it.trailing && <span className="text-ink-dim text-xs">{it.trailing}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
