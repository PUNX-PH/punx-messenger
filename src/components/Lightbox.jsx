import { useEffect } from 'react'

export default function Lightbox({ src, onClose }) {
  useEffect(() => {
    if (!src) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [src, onClose])

  if (!src) return null
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <img
        src={src}
        alt=""
        onMouseDown={(e) => e.stopPropagation()}
        className="rounded shadow-elev2 object-contain"
        style={{ maxWidth: 'min(92vw, 1600px)', maxHeight: 'calc(100vh - 7rem)' }}
      />
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/80 hover:text-white underline underline-offset-2"
      >
        Open original
      </a>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10"
        title="Close (Esc)"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  )
}
