import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { canSeeApps, usableApps } from '../lib/apps'

/**
 * The toolbox in the chat header (shown to developers for now): a short menu of the company's other apps (the list
 * is src/lib/apps.js). Each opens in a new tab. Closes on Escape, on a click outside,
 * and when an app is chosen.
 */
export default function AppsMenu() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const { profile } = useAuth()
  const apps = usableApps()

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Developers only for now (src/lib/apps.js), and nothing at all when there is nothing to open.
  if (!canSeeApps(profile) || apps.length === 0) return null

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'p-1.5 rounded transition-colors',
          open ? 'bg-bg-hover text-ink' : 'text-ink-muted hover:text-ink hover:bg-bg-raised',
        ].join(' ')}
        title="Apps"
        aria-label="Apps"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <ToolboxIcon />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Apps"
          className="absolute top-full right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 overflow-hidden z-30"
        >
          <div className="px-4 py-3 border-b border-line-subtle bg-bg-deepest">
            <div className="font-semibold text-sm">Apps</div>
            <div className="text-xs text-ink-dim mt-0.5">Opens in a new tab. You may need to sign in there.</div>
          </div>
          <ul className="grid grid-cols-3 gap-1 p-2 max-h-80 overflow-y-auto scrollbar-thin">
            {apps.map(a => (
              <li key={a.id} role="none" className="min-w-0">
                <a
                  role="menuitem"
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={a.description ? `${a.name}: ${a.description}` : a.name}
                  onClick={() => setOpen(false)}
                  className="flex flex-col items-center gap-1.5 px-1 py-3 rounded-lg text-center hover:bg-bg-hover focus-visible:bg-bg-hover"
                >
                  <span className="w-11 h-11 rounded-xl bg-bg-deepest border border-line-subtle grid place-items-center text-brand-text">
                    <AppIcon name={a.icon} />
                  </span>
                  <span className="w-full text-xs font-medium leading-tight line-clamp-2 break-words">{a.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Svg({ size = 18, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function ToolboxIcon() {
  return (
    <Svg>
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 13h18" />
      <path d="M10 11v4h4v-4" />
    </Svg>
  )
}

function AppIcon({ name }) {
  if (name === 'clock') {
    return (
      <Svg size={20}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </Svg>
    )
  }
  return (
    <Svg size={20}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  )
}
