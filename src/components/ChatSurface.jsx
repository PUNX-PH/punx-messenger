import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listenMessages, MESSAGE_PAGE, sendMessage, setMessagePinned,
  editMessageText, deleteMessage, toggleReaction, markRead,
  listenContainer, setTyping,
} from '../lib/db'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import MessageList, { PinIcon } from './MessageList'
import Composer from './Composer'
import TypingIndicator from './TypingIndicator'
import SearchDropdown from './SearchDropdown'
import { MenuButton } from './AppShell'

/**
 * Generic chat surface used for DMs, channels, and notes.
 * Props:
 *   - title:     string (header title)
 *   - subtitle?: string
 *   - icon:      '#' | '@' | '✎'
 *   - path:      firestore collection path for messages, e.g. 'dms/<id>/messages'
 *   - composerPlaceholder?: string
 *   - empty?: { title, desc }
 *   - canPin?: boolean   // whether current user can pin/unpin (defaults to false)
 *   - readOnly?: boolean // view without participating (see below)
 */
export default function ChatSurface({
  title, subtitle, icon = '#', path, composerPlaceholder, empty,
  canPin = false,
  canDeleteAny = false, // group admin / workspace admin: can delete anyone's
  headerExtras = null,  // optional extra buttons rendered at the right of the header
  // Look, don't touch. Used by super-admin oversight viewing (see isGhost in
  // lib/auth): the whole point is that nobody in the channel can tell you're
  // reading it, so this has to close off EVERY write, not just the composer —
  // a reaction, an edit, a pin, even a typing indicator would each give it
  // away. Marking-as-read is skipped too, since it would fill your own
  // lastRead map with channels you don't belong to.
  readOnly = false,
  readOnlyNotice = null,
}) {
  const { profile } = useAuth()
  const { byId: usersById } = useUsers()
  const [messages, setMessages] = useState([])
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [jumpId, setJumpId] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [container, setContainer] = useState(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const pinnedRef = useRef(null)
  const searchRef = useRef(null)

  // Container path for typing (drops the trailing /messages). Skip for private notes.
  const containerPath = path && !path.startsWith('users/')
    ? path.replace(/\/messages$/, '')
    : null

  // Listen to container doc for typing map
  useEffect(() => {
    if (!containerPath) return
    return listenContainer(containerPath, setContainer)
  }, [containerPath])

  // Fast ticker (every 2s) so stale typing entries age out promptly
  useEffect(() => {
    if (!containerPath) return
    const t = setInterval(() => setNowTick(Date.now()), 2000)
    return () => clearInterval(t)
  }, [containerPath])

  const typingNames = useMemo(() => {
    const typing = container?.typing || {}
    return Object.entries(typing)
      .filter(([uid, ts]) => {
        if (uid === profile?.uid) return false
        const ms = ts?.toMillis?.() ?? 0
        return nowTick - ms < 6000
      })
      .map(([uid]) => usersById[uid]?.name)
      .filter(Boolean)
  }, [container, profile?.uid, nowTick, usersById])

  // How many messages are currently subscribed. Grows when the list asks for
  // older ones; resets whenever the conversation changes, so switching channels
  // never starts you deep in someone else's history.
  const [limit, setLimit] = useState(MESSAGE_PAGE)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => { setLimit(MESSAGE_PAGE) }, [path])

  useEffect(() => {
    if (!path) return
    return listenMessages(path, (docs, meta) => {
      setMessages(docs)
      setHasMore(meta.hasMore)
      setLoadingMore(false)
    }, limit)
  }, [path, limit])

  const loadOlder = useCallback(() => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setLimit(n => n + MESSAGE_PAGE)
  }, [loadingMore, hasMore])

  // Mark this container read whenever we have messages and the user is here.
  // Skips the personal /users/{uid}/notes path — nothing to track unread for.
  useEffect(() => {
    if (!profile?.uid || !path || readOnly) return
    if (path.startsWith('users/')) return
    const containerPath = path.replace(/\/messages$/, '')
    const t = setTimeout(() => {
      markRead(profile.uid, containerPath).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [profile?.uid, path, messages.length])

  // close pinned dropdown on outside click
  useEffect(() => {
    if (!pinnedOpen) return
    const onClick = (e) => {
      if (!pinnedRef.current?.contains(e.target)) setPinnedOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [pinnedOpen])

  const onSend = async ({ text, imageFile, imageURL, imageMeta }) => {
    await sendMessage(path, { text, imageFile, imageURL, imageMeta, author: profile, replyTo: replyingTo })
    setReplyingTo(null)
    // Clear our typing state on send
    if (containerPath && profile?.uid) setTyping(containerPath, profile.uid, false)
  }

  const onTyping = containerPath && profile?.uid && !readOnly
    ? (isTyping) => setTyping(containerPath, profile.uid, isTyping)
    : null

  const onTogglePin = async (m) => {
    await setMessagePinned(`${path}/${m.id}`, !m.pinned)
  }

  const onEdit = async (m, text) => {
    await editMessageText(`${path}/${m.id}`, text)
  }

  const onDelete = async (m) => {
    await deleteMessage(`${path}/${m.id}`)
  }

  const onReact = async (m, key) => {
    if (!profile?.uid) return
    await toggleReaction(`${path}/${m.id}`, key, profile.uid)
  }

  const pinned = useMemo(
    () => messages.filter(m => m.pinned).slice().reverse(), // newest pinned first
    [messages]
  )

  const jumpTo = (id) => {
    setJumpId(null)
    requestAnimationFrame(() => setJumpId(id))
    setPinnedOpen(false)
    setTimeout(() => setJumpId(null), 1500)
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-bg-main">
      <header className="h-12 border-b border-line-subtle flex items-center px-3 md:px-4 gap-2 shadow-elev1 shrink-0">
        <MenuButton />
        <span className="text-ink-dim">{icon}</span>
        <span className="font-semibold truncate">{title}</span>
        {subtitle && (
          <span className="text-ink-dim text-sm ml-3 border-l border-line-subtle pl-3 truncate">
            {subtitle}
          </span>
        )}

        <div className="flex-1" />

        {/* Search */}
        <div className="relative" ref={searchRef}>
          <button
            onClick={() => { setSearchOpen(o => !o); setPinnedOpen(false) }}
            className={[
              'p-1.5 rounded transition-colors',
              searchOpen
                ? 'bg-bg-hover text-ink'
                : 'text-ink-muted hover:text-ink hover:bg-bg-raised',
            ].join(' ')}
            title="Search this chat"
          >
            <SearchIcon />
          </button>
          {searchOpen && (
            <SearchDropdown
              messages={messages}
              usersById={usersById}
              onJump={jumpTo}
              onClose={() => setSearchOpen(false)}
            />
          )}
        </div>

        {/* Pinned messages button */}
        <div className="relative" ref={pinnedRef}>
          <button
            onClick={() => { setPinnedOpen(o => !o); setSearchOpen(false) }}
            className={[
              'p-1.5 rounded transition-colors',
              pinnedOpen
                ? 'bg-bg-hover text-ink'
                : 'text-ink-muted hover:text-ink hover:bg-bg-raised',
            ].join(' ')}
            title="Pinned messages"
          >
            <PinIcon size={18} />
          </button>
          {pinnedOpen && (
            <PinnedDropdown
              pinned={pinned}
              onJump={jumpTo}
              canPin={canPin}
              onUnpin={onTogglePin}
            />
          )}
        </div>

        {headerExtras}
      </header>

      <MessageList
        messages={messages}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadOlder={loadOlder}
        emptyTitle={empty?.title || 'This is the start of the conversation'}
        emptyDesc={empty?.desc || 'Say hi 👋'}
        canPin={canPin && !readOnly}
        canDeleteAny={canDeleteAny && !readOnly}
        readOnly={readOnly}
        onTogglePin={onTogglePin}
        onEdit={onEdit}
        onDelete={onDelete}
        onReact={readOnly ? null : onReact}
        onReply={readOnly ? null : setReplyingTo}
        onJumpToMessage={jumpTo}
        meUid={profile?.uid}
        scrollToId={jumpId}
        highlightId={jumpId}
      />

      <TypingIndicator names={typingNames} />

      {readOnly ? (
        <div className="shrink-0 mx-4 mb-4 mt-1 px-4 py-3 rounded-lg bg-bg-raised border border-line-subtle text-sm text-ink-muted flex items-start gap-2.5">
          <span className="shrink-0 mt-px text-ink-dim"><LockIcon /></span>
          <span>
            {readOnlyNotice || "Read-only — you can see this conversation but not take part in it."}
          </span>
        </div>
      ) : (
        <Composer
          placeholder={composerPlaceholder || `Message ${icon}${title}`}
          onSend={onSend}
          onTyping={onTyping}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      )}
    </main>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2"/>
      <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}

function PinnedDropdown({ pinned, onJump, canPin, onUnpin }) {
  return (
    <div className="absolute top-full right-0 mt-2 w-[380px] max-h-[480px] bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 overflow-hidden z-30 flex flex-col">
      <div className="px-4 py-3 border-b border-line-subtle bg-bg-deepest">
        <div className="font-semibold text-sm">Pinned messages</div>
        <div className="text-xs text-ink-dim mt-0.5">
          {pinned.length === 0
            ? 'No pinned messages here yet.'
            : `${pinned.length} pinned`}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {pinned.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-muted">
            Hover any message and click the pin icon to keep important things easy to find.
          </div>
        ) : (
          pinned.map(m => (
            <div key={m.id} className="px-4 py-3 border-b border-line-subtle last:border-b-0 hover:bg-bg-hover">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-sm text-ink truncate">{m.author?.name || 'Unknown'}</span>
                <button
                  onClick={() => onJump(m.id)}
                  className="text-xs text-brand hover:underline shrink-0"
                >
                  Jump
                </button>
              </div>
              {m.imageURL && (
                <img src={m.imageURL} alt="" className="mt-1 max-w-full max-h-24 object-contain rounded border border-line-subtle" />
              )}
              {m.text && (
                <div className="text-sm text-ink-muted mt-1 line-clamp-3 whitespace-pre-wrap">{m.text}</div>
              )}
              {canPin && (
                <button
                  onClick={() => onUnpin(m)}
                  className="text-xs text-ink-dim hover:text-bad mt-2"
                >
                  Unpin
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
