import { useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import Lightbox from './Lightbox'
import RoleBadge from './RoleBadge'
import EmojiPicker from './EmojiPicker'
import { useUsers } from '../lib/users'
import { useEmojis } from '../lib/emojis'
import { isOnlyEmojis, mentionsUid, renderMessage } from '../lib/markdown'
import { computeStatus, useTickNow } from '../lib/presence'

export default function MessageList({
  messages, emptyTitle, emptyDesc,
  canPin, onTogglePin,
  canDeleteAny,
  onEdit, onDelete,
  onReact,                // (message, key) => Promise<void>
  meUid,
  highlightId,
  scrollToId,
}) {
  const endRef = useRef(null)
  const containerRef = useRef(null)
  const [zoomed, setZoomed] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const { byId: usersById } = useUsers()
  const { byName: emojiByName } = useEmojis()
  const now = useTickNow()

  useEffect(() => {
    if (scrollToId) return
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length, scrollToId])

  useEffect(() => {
    if (!scrollToId) return
    const el = containerRef.current?.querySelector(`[data-msg-id="${scrollToId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [scrollToId])

  if (!messages?.length) {
    return (
      <div className="flex-1 grid place-items-center px-6">
        <div className="text-center max-w-md text-ink-muted">
          <div className="text-xl font-semibold text-ink mb-1">{emptyTitle}</div>
          <p className="text-sm">{emptyDesc}</p>
        </div>
      </div>
    )
  }

  const groups = []
  for (const m of messages) {
    const last = groups[groups.length - 1]
    const sameAuthor = last && last.author?.uid === m.author?.uid
    const ts = toDate(m.createdAt)
    const close = last && ts && toDate(last.last) && (ts - toDate(last.last)) < 5 * 60 * 1000
    if (sameAuthor && close) {
      last.items.push(m); last.last = m.createdAt
    } else {
      groups.push({ author: m.author, items: [m], first: m.createdAt, last: m.createdAt })
    }
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="py-4 px-4 space-y-4">
        {groups.map((g, i) => (
          <Group
            key={i}
            group={g}
            onZoom={setZoomed}
            canPin={canPin}
            onTogglePin={onTogglePin}
            highlightId={highlightId}
            usersById={usersById}
            emojiByName={emojiByName}
            tickNow={now}
            canDeleteAny={canDeleteAny}
            meUid={meUid}
            editingId={editingId}
            setEditingId={setEditingId}
            onEdit={onEdit}
            onDelete={onDelete}
            onReact={onReact}
          />
        ))}
        <div ref={endRef} />
      </div>
      <Lightbox src={zoomed} onClose={() => setZoomed(null)} />
    </div>
  )
}

function Group({
  group, onZoom, canPin, onTogglePin, highlightId, usersById, emojiByName, tickNow,
  canDeleteAny, meUid, editingId, setEditingId, onEdit, onDelete, onReact,
}) {
  const currentAuthor = usersById?.[group.author?.uid]
  const author = {
    ...group.author,
    name:     currentAuthor?.name     || group.author?.name,
    photoURL: currentAuthor?.photoURL || group.author?.photoURL,
    role:     currentAuthor?.role,
    status:   currentAuthor ? computeStatus(currentAuthor, tickNow) : undefined,
  }
  return (
    <div className="space-y-0">
      {group.items.map((m, idx) => (
        <Row
          key={m.id}
          message={m}
          showHeader={idx === 0}
          author={author}
          firstTime={group.first}
          onZoom={onZoom}
          canPin={canPin}
          onTogglePin={onTogglePin}
          highlighted={highlightId === m.id}
          emojiByName={emojiByName}
          isAuthor={meUid === m.author?.uid}
          canDeleteAny={canDeleteAny}
          editing={editingId === m.id}
          setEditing={(on) => setEditingId(on ? m.id : null)}
          onEdit={onEdit}
          onDelete={onDelete}
          onReact={onReact}
          meUid={meUid}
          usersById={usersById}
        />
      ))}
    </div>
  )
}

function Row({
  message, showHeader, author, firstTime, onZoom, canPin, onTogglePin, highlighted,
  emojiByName, isAuthor, canDeleteAny, editing, setEditing, onEdit, onDelete,
  onReact, meUid, usersById,
}) {
  const onlyEmojis = isOnlyEmojis(message.text)
  const emojiSize = onlyEmojis ? 40 : 22
  const mentionsMe = mentionsUid(message.text, meUid)

  const canEdit = isAuthor
  const canDelete = isAuthor || canDeleteAny
  const reactionEntries = Object.entries(message.reactions || {})
    .filter(([, uids]) => Array.isArray(uids) && uids.length > 0)

  const [reactOpen, setReactOpen] = useState(false)
  const reactBtnRef = useRef(null)

  return (
    <div
      data-msg-id={message.id}
      className={[
        'group/msg relative flex gap-3 -mx-4 px-4 py-0.5 rounded transition-colors',
        'hover:bg-bg-deepest/40',
        highlighted ? 'bg-brand/10' : '',
        mentionsMe ? 'bg-warn/10 border-l-2 border-warn pl-3.5' : '',
        message.pinned && !mentionsMe ? 'border-l-2 border-warn pl-3.5' : '',
      ].join(' ')}
    >
      <div className="w-9 shrink-0">
        {showHeader && <Avatar name={author?.name} src={author?.photoURL} size={36} status={author?.status} ringColor="border-bg-main" />}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2 -mt-0.5 flex-wrap">
            <span className="font-semibold text-ink truncate">{author?.name || 'Unknown'}</span>
            <RoleBadge role={author?.role} size="xs" />
            <span className="text-xs text-ink-dim">{formatTime(firstTime)}</span>
            {message.pinned && <PinnedBadge />}
          </div>
        )}
        {!showHeader && message.pinned && <PinnedBadge className="mb-0.5" />}

        {editing ? (
          <EditField
            initial={message.text || ''}
            onCancel={() => setEditing(false)}
            onSave={async (v) => {
              await onEdit(message, v)
              setEditing(false)
            }}
          />
        ) : (
          <div className="text-ink leading-relaxed break-words">
            {message.imageURL && (
              <button
                type="button"
                onClick={() => onZoom?.(message.imageURL)}
                className="block my-1 rounded-md overflow-hidden border border-line-subtle hover:border-line-strong transition-colors"
                title="Click to expand"
              >
                <img src={message.imageURL} alt="" className="max-w-md max-h-80 object-contain bg-bg-deepest" />
              </button>
            )}
            {message.text && (
              <div className={onlyEmojis ? 'py-0.5' : 'whitespace-pre-wrap'}>
                {renderMessage(message.text, { emojiByName, usersById, emojiSize })}
                {message.editedAt && (
                  <span className="text-[10px] text-ink-dim ml-1.5">(edited)</span>
                )}
              </div>
            )}
            {reactionEntries.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {reactionEntries.map(([key, uids]) => (
                  <ReactionChip
                    key={key}
                    emojiKey={key}
                    uids={uids}
                    meUid={meUid}
                    emojiByName={emojiByName}
                    usersById={usersById}
                    onToggle={() => onReact?.(message, key)}
                  />
                ))}
                {onReact && (
                  <button
                    onClick={() => setReactOpen(true)}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-bg-raised border border-line-subtle text-ink-dim hover:text-ink hover:border-line-strong text-xs"
                    title="Add reaction"
                  >
                    <SmilePlusIcon />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hover toolbar */}
      {!editing && (onReact || canPin || canEdit || canDelete) && (
        <div className="absolute -top-3 right-3 opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 transition-opacity bg-bg-raised border border-line-subtle rounded-md shadow-elev1 flex">
          {onReact && (
            <div className="relative">
              <button
                ref={reactBtnRef}
                onClick={() => setReactOpen(o => !o)}
                className="p-1.5 text-ink-muted hover:text-ink hover:bg-bg-hover rounded transition-colors"
                title="Add reaction"
              >
                <SmilePlusIcon />
              </button>
              <EmojiPicker
                anchorRef={reactBtnRef}
                open={reactOpen}
                onClose={() => setReactOpen(false)}
                onPick={(token) => { onReact(message, token); setReactOpen(false) }}
                position="bottom-right"
              />
            </div>
          )}
          {canEdit && message.text && (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 text-ink-muted hover:text-ink hover:bg-bg-hover rounded transition-colors"
              title="Edit message"
            >
              <PencilIcon />
            </button>
          )}
          {canPin && (
            <button
              onClick={() => onTogglePin?.(message)}
              className="p-1.5 text-ink-muted hover:text-ink hover:bg-bg-hover rounded transition-colors"
              title={message.pinned ? 'Unpin message' : 'Pin message'}
            >
              <PinIcon filled={message.pinned} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => {
                if (confirm('Delete this message?')) onDelete?.(message)
              }}
              className="p-1.5 text-ink-muted hover:text-bad hover:bg-bg-hover rounded transition-colors"
              title="Delete message"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ReactionChip({ emojiKey, uids, meUid, emojiByName, usersById, onToggle }) {
  const mine = uids.includes(meUid)
  const isCustom = /^:[a-z0-9_]{2,32}:$/i.test(emojiKey)
  const customEmoji = isCustom ? emojiByName?.[emojiKey.slice(1, -1).toLowerCase()] : null

  const namesList = uids
    .map(uid => usersById?.[uid]?.name || 'Unknown')
    .join(', ')
  const title = `${namesList} reacted with ${isCustom ? emojiKey : emojiKey}`

  return (
    <button
      onClick={onToggle}
      title={title}
      className={[
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs transition-colors',
        mine
          ? 'bg-brand/15 border-brand/40 text-brand'
          : 'bg-bg-raised border-line-subtle text-ink-muted hover:bg-bg-hover hover:border-line-strong',
      ].join(' ')}
    >
      {customEmoji ? (
        <img src={customEmoji.dataURL} alt={emojiKey} className="w-4 h-4" />
      ) : (
        <span className="text-sm leading-none">{emojiKey}</span>
      )}
      <span className="font-semibold tabular-nums">{uids.length}</span>
    </button>
  )
}

function SmilePlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.5a9 9 0 1 1-8-8.94"/>
      <path d="M16 6h6M19 3v6"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
      <circle cx="9" cy="10" r="0.5" fill="currentColor"/>
      <circle cx="15" cy="10" r="0.5" fill="currentColor"/>
    </svg>
  )
}

function EditField({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    // auto-grow
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'
  }, [])

  const submit = async (e) => {
    e?.preventDefault?.()
    if (busy) return
    setBusy(true)
    try { await onSave(value) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="mt-0.5">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px'
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
        rows={1}
        className="w-full bg-bg-raised border border-line-subtle rounded-md px-3 py-2 text-sm outline-none focus:border-brand resize-none"
      />
      <div className="text-[11px] text-ink-dim mt-1">
        <button type="button" onClick={onCancel} className="text-ink-muted hover:underline">cancel</button>
        {' · '}
        <button type="submit" className="text-brand hover:underline" disabled={busy || !value.trim()}>
          save
        </button>
        <span className="ml-2">Esc to cancel · Enter to save</span>
      </div>
    </form>
  )
}

function PinnedBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] text-warn ${className}`}>
      <PinIcon size={10} filled /> Pinned
    </span>
  )
}

export function PinIcon({ filled, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l2.5 6 6.5.5-5 4.5 1.5 6.5-5.5-3.5L6.5 19.5 8 13 3 8.5l6.5-.5z"/>
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
    </svg>
  )
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
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
