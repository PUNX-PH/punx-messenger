import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * In-chat search dropdown. Filters currently-loaded messages by substring.
 * Props:
 *   messages:   the full loaded message list from ChatSurface
 *   usersById:  workspace user map (for author name resolution)
 *   onJump:     (messageId) => void
 *   onClose:    () => void
 */
export default function SearchDropdown({ messages, usersById, onJump, onClose }) {
  const [q, setQ] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    const onClick = (e) => {
      if (!ref.current?.contains(e.target)) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return []
    return messages
      .filter(m => (m.text || '').toLowerCase().includes(ql))
      .slice()
      .reverse() // newest first
      .slice(0, 100)
  }, [messages, q])

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-2 w-[420px] max-h-[520px] bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 overflow-hidden z-30 flex flex-col"
    >
      <div className="px-3 py-2 border-b border-line-subtle bg-bg-deepest">
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search this chat"
          className="w-full h-8 bg-bg-raised border border-line-subtle rounded-md px-2 text-sm outline-none focus:border-brand"
        />
        {q.trim() && (
          <div className="text-[11px] text-ink-dim mt-1">
            {results.length === 0 ? 'No matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!q.trim() ? (
          <div className="p-6 text-center text-sm text-ink-muted">
            Type to search the currently loaded messages in this chat.
          </div>
        ) : results.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-muted">
            Nothing matches “{q}”.
          </div>
        ) : (
          results.map(m => (
            <button
              key={m.id}
              onClick={() => { onJump(m.id); onClose?.() }}
              className="w-full text-left px-4 py-3 border-b border-line-subtle last:border-b-0 hover:bg-bg-hover"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-ink truncate">
                  {usersById?.[m.author?.uid]?.name || m.author?.name || 'Unknown'}
                </span>
                <span className="text-[10px] text-ink-dim shrink-0">{formatTime(m.createdAt)}</span>
              </div>
              <div className="text-sm text-ink-muted mt-0.5 whitespace-pre-wrap line-clamp-3">
                {highlight(m.text || '', q)}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function highlight(text, q) {
  if (!q || !text) return text
  const out = []
  const tl = text.toLowerCase()
  const ql = q.toLowerCase()
  let i = 0
  let k = 0
  while (i < text.length) {
    const idx = tl.indexOf(ql, i)
    if (idx < 0) { out.push(text.slice(i)); break }
    if (idx > i) out.push(text.slice(i, idx))
    out.push(
      <mark key={k++} className="bg-warn/30 text-ink rounded-sm px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
    )
    i = idx + q.length
  }
  return out
}

function toDate(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts instanceof Date) return ts
  return null
}
function formatTime(ts) {
  const d = toDate(ts)
  if (!d) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
