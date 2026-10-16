import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Avatar from './Avatar'
import Lightbox from './Lightbox'
import RoleBadge from './RoleBadge'
import LazySlot from './LazySlot'
import { EmojiPicker } from '../lib/lazyParts'
import { usePresence, useUsers } from '../lib/users'
import { useEmojis } from '../lib/emojis'
import { isOnlyEmojis, mentionsUid, renderMessage } from '../lib/markdown'
import { computeStatus, useTickNow } from '../lib/presence'

export default function MessageList({
  messages, emptyTitle, emptyDesc,
  hasMore = false,        // older messages exist behind the loaded window
  loadingMore = false,
  onLoadOlder,            // () => void  (widen the window)
  canPin, onTogglePin,
  canDeleteAny,
  onEdit, onDelete,
  onReact,
  onReply,                // (message) => void  (start replying)
  onJumpToMessage,        // (messageId) => void (for replyTo preview jump)
  meUid,
  highlightId,
  scrollToId,
  // Suppresses every action affordance, including the ones a caller can't
  // switch off by withholding a handler: editing and deleting your OWN
  // messages are derived from meUid, and meUid still has to be passed so
  // mention highlighting and reaction "mine" state keep working. Set by
  // ChatSurface's readOnly.
  readOnly = false,
}) {
  const endRef = useRef(null)
  const containerRef = useRef(null)
  const [zoomed, setZoomed] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const { byId: usersById } = useUsers()
  const { byName: emojiByName } = useEmojis()
  const now = useTickNow()
  const presence = usePresence()

  // Distinguishing "a new message arrived" from "older ones were prepended" is
  // the whole job here: the first should follow the conversation down, the
  // second must not move the view at all. Length alone cannot tell them apart,
  // so the id of the oldest loaded message is the tell.
  const firstIdRef = useRef(null)
  const anchorRef = useRef(null)   // scroll metrics captured just before a page lands
  const stickToBottomRef = useRef(true)

  // Follow new messages only when already reading the latest. Someone scrolled
  // up mid-history should stay where they are rather than being yanked down.
  const NEAR_BOTTOM_PX = 120
  // Far enough up that the newest messages are out of sight. Deliberately well
  // past NEAR_BOTTOM_PX, so the pill does not flicker on and off at the edge.
  const FAR_FROM_BOTTOM_PX = 400
  const [awayFromLatest, setAwayFromLatest] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const lastIdRef = useRef(null)

  const onScroll = () => {
    const el = containerRef.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = fromBottom < NEAR_BOTTOM_PX
    // setState with an unchanged value bails out, so this costs nothing per
    // scroll event once the answer stops changing.
    setAwayFromLatest(fromBottom > FAR_FROM_BOTTOM_PX)
    if (fromBottom < NEAR_BOTTOM_PX) setUnseen(0)

    if (!hasMore || loadingMore || !onLoadOlder) return
    if (el.scrollTop < 200) {
      // Capture BEFORE the taller list renders, so the offset can be restored.
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      onLoadOlder()
    }
  }

  useEffect(() => {
    if (scrollToId) return
    const el = containerRef.current
    const firstId = messages?.[0]?.id ?? null
    const grewAtTop = firstIdRef.current !== null
      && firstId !== firstIdRef.current
      && anchorRef.current !== null
    firstIdRef.current = firstId

    if (grewAtTop && el) {
      // Older messages landed above the viewport. Keep the same content under
      // the reader's eyes by re-applying the distance from the bottom.
      const { height, top } = anchorRef.current
      anchorRef.current = null
      el.scrollTop = el.scrollHeight - height + top
      return
    }

    if (stickToBottomRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length, messages?.[0]?.id, scrollToId])

  const lastMsRef = useRef(0) // createdAt of the newest message already accounted for

  // A different conversation is a fresh start: back to the newest, following.
  //
  // Declared BEFORE the new-message counter below, and the order matters: effects
  // run in declaration order, and on mount this one clears the counter's
  // bookkeeping. Declared after it, it wiped what the counter had just recorded,
  // so the first message to arrive after a channel opened was never counted.
  useEffect(() => {
    stickToBottomRef.current = true
    firstIdRef.current = null
    anchorRef.current = null
    lastIdRef.current = null
    lastMsRef.current = 0
    setUnseen(0)
    setAwayFromLatest(false)
  }, [meUid, emptyTitle])

  // Count what arrived at the bottom while the reader was up in the history, so
  // the "jump to latest" control can say there is something to jump to. Keyed on
  // the NEWEST id: older pages landing at the top change the length too, and
  // must not read as news.
  const newest = messages?.length ? messages[messages.length - 1] : null
  const newestId = newest?.id ?? null
  const newestMs = toDate(newest?.createdAt)?.getTime() ?? null
  const newestMine = !!newest && !!meUid && newest.author?.uid === meUid
  useEffect(() => {
    const prevId = lastIdRef.current
    const prevMs = lastMsRef.current
    lastIdRef.current = newestId
    lastMsRef.current = newestMs ?? prevMs
    if (prevId === null || newestId === prevId) return

    if (newestMine) {
      // You just sent it, so you want to see it — wherever you had scrolled to.
      // Counting it as "1 new message" and leaving it off screen was the old
      // behaviour.
      stickToBottomRef.current = true
      setUnseen(0)
      endRef.current?.scrollIntoView({ block: 'end' })
      return
    }
    // Deleting the newest message makes an OLDER one the newest. That is a
    // message going away, not one arriving.
    if (newestMs !== null && prevMs && newestMs < prevMs) return
    if (!stickToBottomRef.current) setUnseen(n => n + 1)
  }, [newestId])

  const jumpToLatest = () => {
    stickToBottomRef.current = true
    setUnseen(0)
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }

  useEffect(() => {
    if (!scrollToId) return
    const el = containerRef.current?.querySelector(`[data-msg-id="${scrollToId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [scrollToId])

  // Day dividers and author groups, in one pass. A new day always starts a new
  // group, so a run of messages never straddles a divider. Rebuilt only when the
  // messages change, not on every render of the list.
  const blocks = useMemo(() => buildBlocks(messages), [messages])

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

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="py-4 px-4 space-y-4">
          {(hasMore || loadingMore) && (
            <div className="grid place-items-center py-2 text-xs text-ink-muted">
              {loadingMore ? 'Loading earlier messages…' : (
                <button onClick={onLoadOlder} className="hover:text-ink transition-colors">
                  Load earlier messages
                </button>
              )}
            </div>
          )}
          {blocks.map(b => b.type === 'day' ? (
            <DayDivider key={b.key} date={b.date} />
          ) : (
            <Group
              key={b.key}
              group={b}
              onZoom={setZoomed}
              canPin={canPin}
              onTogglePin={onTogglePin}
              highlightId={highlightId}
              usersById={usersById}
              emojiByName={emojiByName}
              tickNow={now}
              presenceById={presence}
              canDeleteAny={canDeleteAny}
              readOnly={readOnly}
              meUid={meUid}
              editingId={editingId}
              setEditingId={setEditingId}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
              onReply={onReply}
              onJumpToMessage={onJumpToMessage}
            />
          ))}
          <div ref={endRef} />
        </div>
        <Lightbox src={zoomed} onClose={() => setZoomed(null)} />
      </div>

      {/* `unseen` alone is enough to show it. New messages are counted from
          NEAR_BOTTOM_PX up, but the distance alone only turns the pill on past
          FAR_FROM_BOTTOM_PX — so in between, messages arrived with no sign. */}
      {(awayFromLatest || unseen > 0) && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-full bg-brand text-white text-xs font-medium shadow-elev2 hover:bg-brand-hover transition-colors"
        >
          <ArrowDownIcon />
          {unseen > 0 ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}` : 'Jump to latest'}
        </button>
      )}
    </div>
  )
}

function buildBlocks(messages) {
  const blocks = []
  let lastGroup = null
  let lastDay = null
  for (const m of messages || []) {
    const ts = toDate(m.createdAt)
    // A message still waiting for its server timestamp has no date yet. It
    // belongs to the day already on screen, not to a new one.
    const day = ts ? ts.toDateString() : lastDay
    if (day && day !== lastDay) {
      blocks.push({ type: 'day', key: `day-${day}`, date: ts })
      lastDay = day
      lastGroup = null
    }
    const lastTs = lastGroup && toDate(lastGroup.last)
    const close = lastGroup && (!ts || !lastTs || (ts - lastTs) < 5 * 60 * 1000)
    if (lastGroup && lastGroup.author?.uid === m.author?.uid && close) {
      lastGroup.items.push(m); lastGroup.last = m.createdAt
    } else {
      lastGroup = {
        type: 'group',
        // The first message's id, not the array index: older pages are
        // prepended, and an index key would remount — and so reset — every
        // group on screen each time one loaded.
        key: m.id,
        author: m.author,
        items: [m], first: m.createdAt, last: m.createdAt,
      }
      blocks.push(lastGroup)
    }
  }
  return blocks
}

function DayDivider({ date }) {
  return (
    <div role="separator" aria-label={dayLabel(date)} className="flex items-center gap-3 select-none">
      <div className="h-px flex-1 bg-line-subtle" />
      <span className="text-xs font-medium text-ink-muted">{dayLabel(date)}</span>
      <div className="h-px flex-1 bg-line-subtle" />
    </div>
  )
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <polyline points="19 12 12 19 5 12"/>
    </svg>
  )
}

const Group = memo(function Group({
  group, onZoom, canPin, onTogglePin, highlightId, usersById, presenceById, emojiByName, tickNow,
  canDeleteAny, readOnly, meUid, editingId, setEditingId, onEdit, onDelete, onReact,
  onReply, onJumpToMessage,
}) {
  const currentAuthor = usersById?.[group.author?.uid]
  const name = currentAuthor?.name || group.author?.name
  const photoURL = currentAuthor?.photoURL || group.author?.photoURL
  const role = currentAuthor?.role
  const status = currentAuthor ? computeStatus(presenceById?.[currentAuthor.id], tickNow) : undefined
  // The same object until one of these changes, so a status ageing out re-renders
  // the header row of this group and none of the rest.
  const author = useMemo(
    () => ({ ...group.author, name, photoURL, role, status }),
    [group.author, name, photoURL, role, status],
  )
  return (
    <div className="space-y-0">
      {group.items.map((m, idx) => (
        <Row
          key={m.id}
          message={m}
          showHeader={idx === 0}
          // Only the first row of a group shows the author, so only it is told.
          author={idx === 0 ? author : null}
          firstTime={idx === 0 ? group.first : null}
          onZoom={onZoom}
          canPin={canPin}
          onTogglePin={onTogglePin}
          highlighted={highlightId === m.id}
          emojiByName={emojiByName}
          isAuthor={meUid === m.author?.uid}
          canDeleteAny={canDeleteAny}
          readOnly={readOnly}
          editing={editingId === m.id}
          setEditingId={setEditingId}
          onEdit={onEdit}
          onDelete={onDelete}
          onReact={onReact}
          onReply={onReply}
          onJumpToMessage={onJumpToMessage}
          meUid={meUid}
          usersById={usersById}
        />
      ))}
    </div>
  )
})

// Memoised: a conversation re-renders for reasons that have nothing to do with
// any one message (a scroll position, someone typing, a status ageing), and the
// markdown of every message on screen used to be parsed again each time. A row
// now renders again only when its own message, or something it shows, changes.
const Row = memo(function Row({
  message, showHeader, author, firstTime, onZoom, canPin, onTogglePin, highlighted,
  emojiByName, isAuthor, canDeleteAny, readOnly, editing, setEditingId, onEdit, onDelete,
  onReact, onReply, onJumpToMessage, meUid, usersById,
}) {
  const setEditing = (on) => setEditingId(on ? message.id : null)
  const onlyEmojis = isOnlyEmojis(message.text)
  const emojiSize = onlyEmojis ? 40 : 22
  const mentionsMe = mentionsUid(message.text, meUid)

  // One background decides, rather than several competing bg-* classes whose
  // winner would depend on Tailwind's emit order. Mentions and pins are marked
  // by tint alone — a thick coloured edge on a row is a banned pattern, and the
  // Pinned badge already says what the tint means.
  const tone = highlighted ? 'bg-brand/10'
    : mentionsMe ? 'bg-warn/10 hover:bg-warn/15'
    : message.pinned ? 'bg-warn/5 hover:bg-warn/10'
    : 'hover:bg-bg-deepest/40'

  const canEdit = isAuthor && !readOnly
  const canDelete = (isAuthor || canDeleteAny) && !readOnly
  const reactionEntries = Object.entries(message.reactions || {})
    .filter(([, uids]) => Array.isArray(uids) && uids.length > 0)

  const [reactOpen, setReactOpen] = useState(false)
  const reactBtnRef = useRef(null)

  return (
    <div
      data-msg-id={message.id}
      className={`group/msg relative flex gap-3 -mx-4 px-4 py-0.5 rounded transition-colors ${tone}`}
    >
      <div className="w-9 shrink-0">
        {showHeader ? (
          <Avatar name={author?.name} src={author?.photoURL} size={36} status={author?.status} ringColor="border-bg-main" />
        ) : (
          // The time of a follow-on message, in the space its avatar would
          // take. Always laid out and only faded in, so hovering never moves
          // the text beside it.
          <span
            className="block whitespace-nowrap text-right text-[10px] leading-6 text-ink-dim tabular-nums opacity-0 group-hover/msg:opacity-100 transition-opacity"
            title={fullTime(message.createdAt)}
          >
            {clockTime(message.createdAt)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {message.replyTo && (
          <button
            type="button"
            onClick={() => onJumpToMessage?.(message.replyTo.messageId)}
            className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink max-w-full mb-0.5"
            title="Jump to replied message"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ink-dim">
              <polyline points="9 14 4 9 9 4"/>
              <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
            </svg>
            <span className="text-brand-text font-medium shrink-0">
              @{usersById?.[message.replyTo.authorUid]?.name || message.replyTo.authorName}
            </span>
            <span className="truncate opacity-75">{message.replyTo.snippet}</span>
          </button>
        )}

        {showHeader && (
          <div className="flex items-baseline gap-2 -mt-0.5 flex-wrap">
            <span className="font-semibold text-ink truncate">{author?.name || 'Unknown'}</span>
            <RoleBadge role={author?.role} size="xs" />
            <span className="text-xs text-ink-dim" title={fullTime(firstTime)}>{formatTime(firstTime)}</span>
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
                    onToggle={readOnly ? null : () => onReact?.(message, key)}
                  />
                ))}
                {onReact && (
                  <button
                    onClick={() => setReactOpen(true)}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-bg-raised border border-line-subtle text-ink-dim hover:text-ink hover:border-line-strong text-xs"
                    title="Add reaction"
                    aria-label="Add reaction"
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
      {!editing && (onReact || onReply || canPin || canEdit || canDelete) && (
        <div className="absolute -top-3 right-3 opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 transition-opacity bg-bg-raised border border-line-subtle rounded-md shadow-elev1 flex">
          {onReact && (
            <div className="relative">
              <button
                ref={reactBtnRef}
                onClick={() => setReactOpen(o => !o)}
                className="p-1.5 text-ink-muted hover:text-ink hover:bg-bg-hover rounded transition-colors"
                title="Add reaction"
                aria-label="Add reaction"
              >
                <SmilePlusIcon />
              </button>
              {/* Mounted only while open. This used to sit hidden inside EVERY
                  message row, each with its own hooks and state. */}
              {reactOpen && (
                <LazySlot overlay onDismiss={() => setReactOpen(false)}>
                  <EmojiPicker
                    anchorRef={reactBtnRef}
                    open
                    onClose={() => setReactOpen(false)}
                    onPick={(token) => { onReact(message, token); setReactOpen(false) }}
                    position="bottom-right"
                  />
                </LazySlot>
              )}
            </div>
          )}
          {onReply && (
            <button
              onClick={() => onReply(message)}
              className="p-1.5 text-ink-muted hover:text-ink hover:bg-bg-hover rounded transition-colors"
              title="Reply"
              aria-label="Reply"
            >
              <ReplyIcon />
            </button>
          )}
          {canEdit && message.text && (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 text-ink-muted hover:text-ink hover:bg-bg-hover rounded transition-colors"
              title="Edit message"
              aria-label="Edit message"
            >
              <PencilIcon />
            </button>
          )}
          {canPin && (
            <button
              onClick={() => onTogglePin?.(message)}
              className="p-1.5 text-ink-muted hover:text-ink hover:bg-bg-hover rounded transition-colors"
              title={message.pinned ? 'Unpin message' : 'Pin message'}
              aria-label={message.pinned ? 'Unpin message' : 'Pin message'}
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
              aria-label="Delete message"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      )}
    </div>
  )
})

function ReactionChip({ emojiKey, uids, meUid, emojiByName, usersById, onToggle }) {
  const mine = uids.includes(meUid)
  const isCustom = /^:[a-z0-9_]{2,32}:$/i.test(emojiKey)
  const customEmoji = isCustom ? emojiByName?.[emojiKey.slice(1, -1).toLowerCase()] : null

  const namesList = uids
    .map(uid => usersById?.[uid]?.name || 'Unknown')
    .join(', ')
  const title = `${namesList} reacted with ${isCustom ? emojiKey : emojiKey}`

  // No onToggle means read-only (see MessageList's readOnly) — keep the count
  // visible, but don't offer a chip that silently does nothing.
  return (
    <button
      onClick={onToggle || undefined}
      disabled={!onToggle}
      title={title}
      className={[
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs transition-colors',
        mine
          ? 'bg-brand/15 border-brand/40 text-brand-text'
          : 'bg-bg-raised border-line-subtle text-ink-muted',
        onToggle && !mine ? 'hover:bg-bg-hover hover:border-line-strong' : '',
        onToggle ? '' : 'cursor-default',
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

function ReplyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 17 4 12 9 7"/>
      <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
    </svg>
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

  const [error, setError] = useState(null)

  const submit = async (e) => {
    e?.preventDefault?.()
    // The Save button is disabled for a blank value, but Enter calls this
    // directly. Saving "" left an empty row its author could no longer edit
    // (there is no text to hang the edit button on).
    if (busy || !value.trim()) return
    setBusy(true)
    setError(null)
    try { await onSave(value) }
    catch (err) { setError(err?.message || "Couldn't save your edit.") }
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
          // isComposing: Enter confirms a candidate in an IME (Japanese,
          // Chinese, Korean...) and must not also save the half-typed edit.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
        }}
        rows={1}
        className="w-full bg-bg-raised border border-line-subtle rounded-md px-3 py-2 text-sm outline-none focus:border-brand resize-none"
      />
      {error && (
        <div role="alert" className="mt-1 text-xs text-bad">{error}</div>
      )}
      <div className="text-[11px] text-ink-dim mt-1">
        <button type="button" onClick={onCancel} className="text-ink-muted hover:underline">cancel</button>
        {' · '}
        <button type="submit" className="text-brand-text hover:underline" disabled={busy || !value.trim()}>
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
/** "Today", "Yesterday", "Tuesday, March 4" (plus the year when it is not this one). */
function dayLabel(d) {
  if (!d) return ''
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], {
    weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  })
}
// "9:01", not "9:01 AM": the gutter it sits in is the width of an avatar, and
// the full time is on the tooltip. Built from parts rather than by cutting a
// formatted string, so a locale that puts the day period first still works.
const clockTime = (ts) => {
  const d = toDate(ts)
  if (!d) return ''
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })
    .formatToParts(d)
    .filter(p => p.type !== 'dayPeriod')
    .map(p => p.value)
    .join('')
    .trim()
}
const fullTime = (ts) => {
  const d = toDate(ts)
  return d ? d.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }) : ''
}
// Time only. The day is on the divider above, so repeating "Oct 13," on every
// header just made each one longer to read; the tooltip still has the full date.
function formatTime(ts) {
  const d = toDate(ts)
  return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
}
