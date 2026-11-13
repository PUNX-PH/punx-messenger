import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import Avatar from './Avatar'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import { useConversationData } from '../lib/useConversationData'
import { buildTargets, rankTargets } from '../lib/quickSwitch'
import { mutedChatsOf } from '../lib/muted'

/**
 * "Jump to": type part of a name, press Enter. People, channels (and the group they
 * are in), voice rooms and your notes, with what is unread first. "#" narrows to
 * channels, "@" to people. Arrow keys move, Enter opens, Escape closes.
 */
export default function QuickSwitcher({ onClose }) {
  const { profile } = useAuth()
  const { byId, activeUsers } = useUsers()
  const { convosByOther, groups, channelsByGroup } = useConversationData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef(null)
  const listId = useId()

  const me = byId[profile?.id]
  const targets = useMemo(() => buildTargets({
    meUid: profile?.id, users: activeUsers, convosByOther, groups, channelsByGroup,
    lastRead: me?.lastRead || {}, mutedGroups: new Set(me?.mutedGroups || []), mutedChats: mutedChatsOf(me),
  }), [profile?.id, activeUsers, convosByOther, groups, channelsByGroup, me?.lastRead, me?.mutedGroups, me?.mutedChats])

  const results = useMemo(() => rankTargets(targets, query), [targets, query])

  // A new query starts at the best match.
  useEffect(() => { setIndex(0) }, [query])
  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const go = (target) => {
    if (!target) return
    onClose()
    navigate(target.path)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => (results.length ? (i + 1) % results.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => (results.length ? (i - 1 + results.length) % results.length : 0)) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); go(results[index]) }
  }

  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || '')
  const active = results[index]

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg">
      <div className="p-3">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? `${listId}-${index}` : undefined}
          aria-label="Jump to a conversation"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to a person or channel…"
          className="w-full bg-bg-deepest border border-line-subtle rounded-md px-3 py-2.5 text-sm outline-none focus:border-brand"
        />
        <ul id={listId} ref={listRef} role="listbox" className="mt-2 max-h-80 overflow-y-auto scrollbar-thin space-y-0.5">
          {results.map((t, i) => (
            <li
              key={t.id} id={`${listId}-${i}`} role="option" aria-selected={i === index}
              onMouseMove={() => { if (i !== index) setIndex(i) }}
              onClick={() => go(t)}
              className={['flex items-center gap-3 px-2.5 py-1.5 rounded-md cursor-pointer', i === index ? 'bg-bg-hover' : ''].join(' ')}
            >
              <span className="w-7 h-7 grid place-items-center shrink-0 text-ink-dim">
                {t.kind === 'dm'
                  ? <Avatar name={t.label} src={t.user?.photoURL} size={26} />
                  : <span className="text-base font-semibold" aria-hidden="true">{t.kind === 'channel' ? '#' : t.kind === 'voice' ? '🔊' : '✎'}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={['block truncate text-sm', t.unread ? 'font-semibold text-ink' : 'text-ink'].join(' ')}>{t.label}</span>
                {t.hint && <span className="block truncate text-xs text-ink-dim">{t.kind === 'channel' || t.kind === 'voice' ? `in ${t.hint}` : t.hint}</span>}
              </span>
              {t.unread && <span className="shrink-0 w-2 h-2 rounded-full bg-brand" role="img" aria-label="Unread" />}
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink-muted" role="presentation">Nothing matches &ldquo;{query}&rdquo;.</li>
          )}
        </ul>
        <div className="mt-2 pt-2 border-t border-line-subtle flex items-center justify-between gap-3 text-[11px] text-ink-dim">
          <span>↑↓ to move · Enter to open · Esc to close</span>
          <span>Type # for channels, @ for people · {isMac ? '⌘' : 'Ctrl+'}K anywhere</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">{isMac ? 'Option' : 'Alt'}+Shift+↑/↓ anywhere jumps to the next unread conversation.</p>
      </div>
    </Modal>
  )
}
