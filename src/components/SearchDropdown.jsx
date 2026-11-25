import { useEffect, useMemo, useRef, useState } from 'react'
import { FILTER_CHIPS, hasToken, searchMessages, toggleToken } from '../lib/searchFilters'
import { hideSpoilers } from '../lib/spoilers'
import { highlightParts } from '../lib/highlight'
import { chatPeople, moveHighlight, openPersonPiece, pickPerson, suggestPeople } from '../lib/searchPeople'

/**
 * In-chat search dropdown. Searches the currently-loaded messages for words and for filters
 * (from:, has:image, before:..., see lib/searchFilters.js), which can be typed or pressed.
 * Props:
 *   messages:   the full loaded message list from ChatSurface
 *   usersById:  workspace user map (for author name resolution)
 *   meUid:      who is searching (for from:me and mentions:me)
 *   onJump:     (messageId) => void
 *   onClose:    () => void
 */
export default function SearchDropdown({ messages, usersById, meUid, onJump, onClose }) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0) // which person is highlighted, while the people are offered
  const ref = useRef(null)
  const inputRef = useRef(null)

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

  const { results, parsed, active } = useMemo(
    () => searchMessages(messages, q, { usersById, meUid }),
    [messages, q, usersById, meUid],
  )

  // While the box ends in "from:" or "mentions:" and a part of a name, the people of this chat are offered.
  const piece = useMemo(() => openPersonPiece(q), [q])
  const people = useMemo(
    () => (piece ? suggestPeople(piece, chatPeople(messages, usersById, piece.op), { meUid }) : []),
    [piece, messages, usersById, meUid],
  )
  const choose = (value) => {
    setQ(pickPerson(q, piece, value))
    setHi(0)
    inputRef.current?.focus()
  }
  const at = Math.min(hi, people.length - 1) // (the list can have got shorter since the highlight was set)
  const onInputKey = (e) => {
    if (!people.length) return
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return // an IME is still composing: Enter belongs to it
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setHi(moveHighlight(at, e.key, people.length)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(people[at].value) } // (not Tab: that must still move on)
  }

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-2 w-[420px] max-h-[520px] bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 overflow-hidden z-30 flex flex-col"
    >
      <div className="px-3 py-2 border-b border-line-subtle bg-bg-deepest">
        <input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={e => { setQ(e.target.value); setHi(0) }}
          onKeyDown={onInputKey}
          role="combobox"
          aria-expanded={people.length > 0}
          aria-controls={people.length > 0 ? 'search-people' : undefined}
          aria-activedescendant={people.length > 0 ? `search-person-${at}` : undefined}
          aria-autocomplete="list"
          placeholder="Search this chat"
          className="w-full h-8 bg-bg-raised border border-line-subtle rounded-md px-2 text-sm outline-none focus:border-brand"
        />
        {people.length > 0 && (
          <ul id="search-people" role="listbox" aria-label={piece.op === 'from' ? 'People who wrote here' : 'People mentioned here'} className="mt-2 border border-line-subtle rounded-md overflow-hidden bg-bg-raised">
            {people.map((p, i) => (
              <li key={p.value} id={`search-person-${i}`} role="option" aria-selected={i === at}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => choose(p.value)}
                  onMouseEnter={() => setHi(i)}
                  className={['w-full text-left px-2 h-7 text-sm flex items-baseline justify-between gap-2', i === at ? 'bg-bg-hover text-ink' : 'text-ink-muted'].join(' ')}
                >
                  <span className="truncate">{p.label}</span>
                  {p.hint && <span className="text-[10px] text-ink-dim shrink-0">{p.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="Only messages with">
          {FILTER_CHIPS.map(c => {
            const on = hasToken(q, c.token)
            return (
              <button
                key={c.token}
                type="button"
                aria-pressed={on}
                onClick={() => { setQ(toggleToken(q, c.token)); inputRef.current?.focus() }}
                className={[
                  'h-6 px-2 rounded-full text-[11px] border transition-colors',
                  on ? 'bg-brand/20 border-brand text-ink' : 'border-line-subtle text-ink-muted hover:text-ink hover:bg-bg-hover',
                ].join(' ')}
              >
                {c.label}
              </button>
            )
          })}
        </div>
        {parsed.problems.map(p => (
          <div key={p} className="text-[11px] text-warn mt-1" role="status">{p}</div>
        ))}
        {active && (
          <div className="text-[11px] text-ink-dim mt-1">
            {results.length === 0 ? 'No matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!active ? (
          <div className="p-6 text-center text-sm text-ink-muted">
            <div>Type to search the currently loaded messages in this chat.</div>
            <div className="mt-2 text-xs text-ink-dim">
              Narrow it down with <code>from:name</code> <code>has:image</code> <code>is:pinned</code> <code>before:2026-11-01</code> <code>after:…</code> <code>on:…</code> <code>mentions:me</code>
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-muted">
            Nothing matches “{q.trim()}”.
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
                {m.text ? highlight(hideSpoilers(m.text), parsed.text) : <span className="italic text-ink-dim">{kindOf(m)}</span>}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// The words searched for are marked (capitals and accents do not matter; see lib/highlight.js).
function highlight(text, q) {
  return highlightParts(text, q).map((part, k) => (
    part.match
      ? <mark key={k} className="bg-warn/30 text-ink rounded-sm px-0.5">{part.text}</mark>
      : part.text
  ))
}

// What stands in for words in a result that has none (a picture or a voice message on its own).
function kindOf(m) {
  if (m.imageURL) return 'Picture'
  if (m.audioURL) return 'Voice message'
  return ''
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
