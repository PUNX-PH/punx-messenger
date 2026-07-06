import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function Modal({ open, onClose, children, maxWidth = 'max-w-md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    // Lock scroll on the body so the page behind doesn't jump
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  // Portal to <body> so `position: fixed` isn't re-anchored by any transformed
  // ancestor (e.g. the sidebar drawer's translate-x animation).
  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className={`bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 w-full ${maxWidth} max-h-[calc(100dvh-2rem)] overflow-y-auto scrollbar-thin`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
