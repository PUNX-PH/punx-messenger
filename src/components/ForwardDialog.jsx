import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import Avatar from './Avatar'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import { useConversationData } from '../lib/useConversationData'
import { buildTargets, rankTargets } from '../lib/quickSwitch'
import { mutedChatsOf } from '../lib/muted'
import { dmConvoId, ensureDmConvo, sendMessage } from '../lib/db'
import { destinationPath, forwardPayload, forwardPreview, forwardTargets } from '../lib/forward'

/**
 * "Forward to...": pick a person, a channel or your notes and the message goes there as a new
 * message from you, marked "Forwarded from <who wrote it>". What is copied, and what is not, is
 * src/lib/forward.js. One destination at a time; the dialog says where it went and closes.
 */
export default function ForwardDialog({ message, currentPath, onClose }) {
  const { profile } = useAuth()
  const { byId, activeUsers } = useUsers()
  const { convosByOther, groups, channelsByGroup } = useConversationData()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const listRef = useRef(null)
  const listId = useId()
  const closeTimer = useRef(null)
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const me = byId[profile?.id]
  const targets = useMemo(() => forwardTargets(buildTargets({
    meUid: profile?.id, users: activeUsers, convosByOther, groups, channelsByGroup,
    lastRead: me?.lastRead || {}, mutedGroups: new Set(me?.mutedGroups || []), mutedChats: mutedChatsOf(me),
  }), { meUid: profile?.id, currentPath, dmId: dmConvoId }), [profile?.id, activeUsers, convosByOther, groups, channelsByGroup, me?.lastRead, me?.mutedGroups, me?.mutedChats, currentPath])

  const results = useMemo(() => rankTargets(targets, query, 20), [targets, query])
  useEffect(() => { setIndex(0) }, [query])
  useEffect(() => { listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' }) }, [index])

  const send = async (target) => {
    if (!target || busy || sentTo) return
    const payload = forwardPayload(message, byId)
    const path = destinationPath(target, profile?.id, dmConvoId)
    if (!payload || !path) return
    setBusy(true); setError('')
    try {
      // A person you have not messaged yet has no conversation to put it in.
      if (target.kind === 'dm') await ensureDmConvo(profile, target.user)
      await sendMessage(path, { ...payload, author: profile })
      setSentTo(target.kind === 'notes' ? 'your notes' : target.kind === 'channel' ? `#${target.label}` : target.label)
      closeTimer.current = setTimeout(onClose, 1100)
    } catch {
      setError("Couldn't forward it. Check your connection and try again.")
      setBusy(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => (results.length ? (i + 1) % results.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => (results.length ? (i - 1 + results.length) % results.length : 0)) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(results[index]) }
  }

  const author = byId[message?.author?.uid]?.name || message?.author?.name || 'Unknown'
  const active = results[index]

  return (
    <Modal open onClose={busy && !sentTo ? undefined : onClose} maxWidth="max-w-lg">
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-2">Forward message</h2>
        <div className="mb-3 px-3 py-2 rounded-md bg-bg-deepest border border-line-subtle text-sm">
          <div className="text-xs text-ink-dim mb-0.5">{author}</div>
          <div className="text-ink-muted break-words">{forwardPreview(message, 160, byId)}</div>
        </div>

        {sentTo ? (
          <div role="status" className="py-6 text-center text-sm text-ink">Forwarded to {sentTo}.</div>
        ) : (
          <>
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={active ? `${listId}-${index}` : undefined}
              aria-label="Forward to"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search for a person or channel…"
              className="w-full bg-bg-deepest border border-line-subtle rounded-md px-3 py-2.5 text-sm outline-none focus:border-brand"
            />
            <ul id={listId} ref={listRef} role="listbox" className="mt-2 max-h-72 overflow-y-auto scrollbar-thin space-y-0.5">
              {results.map((t, i) => (
                <li
                  key={t.id} id={`${listId}-${i}`} role="option" aria-selected={i === index}
                  onMouseMove={() => { if (i !== index) setIndex(i) }}
                  onClick={() => send(t)}
                  className={['flex items-center gap-3 px-2.5 py-1.5 rounded-md cursor-pointer', i === index ? 'bg-bg-hover' : '', busy ? 'opacity-60 pointer-events-none' : ''].join(' ')}
                >
                  <span className="w-7 h-7 grid place-items-center shrink-0 text-ink-dim">
                    {t.kind === 'dm'
                      ? <Avatar name={t.label} src={t.user?.photoURL} size={26} />
                      : <span className="text-base font-semibold" aria-hidden="true">{t.kind === 'channel' ? '#' : '✎'}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{t.label}</span>
                    {t.hint && <span className="block truncate text-xs text-ink-dim">{t.kind === 'channel' ? `in ${t.hint}` : t.hint}</span>}
                  </span>
                </li>
              ))}
              {results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-ink-muted" role="presentation">Nothing matches &ldquo;{query}&rdquo;.</li>
              )}
            </ul>
            {error && <div role="alert" className="mt-2 text-sm text-bad">{error}</div>}
            <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-ink-dim">
              <span>↑↓ to move · Enter to forward · Esc to close</span>
              <button type="button" onClick={onClose} disabled={busy} className="px-2.5 py-1 text-xs rounded-md bg-bg-raised text-ink hover:bg-bg-hover border border-line-subtle disabled:opacity-50">Cancel</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
