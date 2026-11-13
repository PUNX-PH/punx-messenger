import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  listenMessages, MESSAGE_PAGE, sendMessage, setMessagePinned,
  editMessageText, deleteMessage, toggleReaction, markRead,
  listenContainer, setTyping,
} from '../lib/db'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import { whoIsTyping } from '../lib/typing'
import { sameMessages } from '../lib/messagesIdentity'
import { describeListenError } from '../lib/listenError'
import { usePageActive } from '../lib/usePageActive'
import { firstUnreadId, needsMarkRead } from '../lib/unread'
import { pathToReadKey } from '../lib/db'
import { lastEditableMessage } from '../lib/editLast'
import { copyToClipboard } from '../lib/clipboard'
import { saveMessageToNotes } from '../lib/db'
import { savedNoteId, savedPayload } from '../lib/saved'
import LazySlot from './LazySlot'
import { ForwardDialog } from '../lib/lazyParts'
import { LINK_LOOKBACK, MESSAGE_PARAM, messageIdFromSearch, messageLink, nextLinkStep } from '../lib/messageLink'
import ErrorBoundary from './ErrorBoundary'
import MessageList, { PinIcon } from './MessageList'
import Composer from './Composer'
import TypingIndicator from './TypingIndicator'
import SearchDropdown from './SearchDropdown'
import AppsMenu from './AppsMenu'
import { MenuButton } from './AppShell'

// One shared empty list, so "no messages yet" is the same object every render.
const NO_MESSAGES = []

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
  // The messages come tagged with the conversation they belong to. This component stays
  // mounted as you switch conversations, so a plain list would show the PREVIOUS
  // conversation's messages under the new one's title until the new ones arrive (and the
  // mark-read effect below would run on them). Reading them back through the path means
  // nothing from another conversation is ever shown, and `loaded` says when these are ours.
  // `limit` is how many messages the window asked for when these arrived (see the link-following below).
  const [batch, setBatch] = useState({ path: null, docs: NO_MESSAGES, limit: 0 })
  const loaded = batch.path === path
  const messages = loaded ? batch.docs : NO_MESSAGES
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [jumpId, setJumpId] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)
  const [forwarding, setForwarding] = useState(null) // the message being forwarded (its picker is open)
  const [container, setContainer] = useState(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const pinnedRef = useRef(null)
  const searchRef = useRef(null)
  // Where the "New" line goes in the conversation you just opened: the first message you
  // had not read at that moment. Decided once per opening, from the first batch of
  // messages, and then left where it is while you read (marking the chat read moves
  // your last-read time, which must not drag the line along).
  const [newFrom, setNewFrom] = useState(null) // { path, id }
  const newFromDecidedFor = useRef(null)
  const readAtEntry = useRef({ known: false }) // your last-read time when this conversation was opened

  // Container path for typing (drops the trailing /messages). Skip for private notes.
  const containerPath = path && !path.startsWith('users/')
    ? path.replace(/\/messages$/, '')
    : null

  // Listen to container doc for typing map
  useEffect(() => {
    if (!containerPath) return
    return listenContainer(containerPath, setContainer)
  }, [containerPath])

  // Wake up when the next typing entry runs out, and not otherwise. This used to
  // be a timer ticking every 2s in every open conversation, re-rendering the
  // whole message list each time to learn that nobody was typing.
  useEffect(() => {
    const { expiresIn } = whoIsTyping(container?.typing, profile?.uid, Date.now())
    if (expiresIn === null) return
    const t = setTimeout(() => setNowTick(Date.now()), expiresIn + 50)
    return () => clearTimeout(t)
  }, [container, profile?.uid, nowTick])

  const typingNames = useMemo(() => {
    const { uids } = whoIsTyping(container?.typing, profile?.uid, nowTick)
    return uids.map(uid => usersById[uid]?.name).filter(Boolean)
  }, [container, profile?.uid, nowTick, usersById])

  // How many messages are currently subscribed. Grows when the list asks for
  // older ones; resets whenever the conversation changes, so switching channels
  // never starts you deep in someone else's history.
  const [limit, setLimit] = useState(MESSAGE_PAGE)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Set when the messages listener fails (no access, offline, missing index). A
  // failed listener is dead, so "Try again" subscribes afresh via reloadKey.
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => { setLimit(MESSAGE_PAGE) }, [path])

  // This component stays mounted as you move between conversations, so anything
  // that belongs to one conversation has to be dropped on the way out. Without it a
  // "replying to" chosen in one channel was still pending in the next.
  useEffect(() => {
    setReplyingTo(null)
    setForwarding(null)
    setPinnedOpen(false)
    setSearchOpen(false)
    setJumpId(null)
    // Opening a conversation (again) decides the "New" line afresh. Your last-read time is
    // taken NOW, at the moment of opening, not when the messages arrive: the chat is marked
    // read 400 ms after opening whether or not its messages have loaded yet, so on a slow
    // connection the time read later would already be "just now" and the line would be lost.
    newFromDecidedFor.current = null
    setNewFrom(null)
    const meNow = usersByIdRef.current?.[profile?.uid]
    readAtEntry.current = meNow && path && !path.startsWith('users/')
      ? { known: true, at: meNow.lastRead?.[pathToReadKey(path.replace(/\/messages$/, ''))] }
      : { known: false }
  }, [path])

  useEffect(() => {
    if (!path) return
    return listenMessages(path, (docs, meta) => {
      setLoadError(null)
      // Same messages as the same objects: nothing to do (see messagesIdentity.js).
      setBatch(prev => (prev.path === path && sameMessages(prev.docs, docs) ? prev : { path, docs, limit }))
      // The first batch for this opening, once we know our own read times (they arrive
      // with the user directory). Not for a read-only look at a channel you are not in,
      // nor private notes: neither tracks what you have read.
      // Our read times are the ones taken when the conversation was opened. If the user
      // directory had not arrived by then, the current ones are the best there is (they can
      // only be later, which puts the line later, never earlier than the truth).
      const entry = readAtEntry.current
      const me = usersByIdRef.current?.[profile?.uid]
      if (newFromDecidedFor.current !== path && (entry?.known || me) && docs.length && !readOnly && !path.startsWith('users/')) {
        newFromDecidedFor.current = path
        const lastRead = entry?.known ? entry.at : me.lastRead?.[pathToReadKey(path.replace(/\/messages$/, ''))]
        setNewFrom({ path, id: firstUnreadId(docs, lastRead, profile.uid) })
      }
      setHasMore(meta.hasMore)
      setLoadingMore(false)
    }, limit, (err) => {
      console.error('[chat] could not load messages for', path, err)
      // Not the previous conversation's messages, and not a bare empty list that
      // reads as "nothing here yet".
      setBatch({ path, docs: NO_MESSAGES })
      setLoadingMore(false)
      setLoadError(describeListenError(err))
    })
  }, [path, limit, reloadKey])

  // A different conversation starts without the last one's error.
  useEffect(() => { setLoadError(null) }, [path])

  const loadOlder = useCallback(() => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setLimit(n => n + MESSAGE_PAGE)
  }, [loadingMore, hasMore])

  // Mark this container read whenever we have messages and the user is here.
  // Skips the personal /users/{uid}/notes path — nothing to track unread for.
  //
  // Keyed on the NEWEST message's id, not the number of messages. The listener
  // is a fixed-size window over the latest messages, so once a channel has more
  // than a page the count stays put while new messages slide the window along:
  // watching a busy channel live never re-marked it read, and it showed unread
  // the moment you left.
  const newestId = messages.length ? messages[messages.length - 1].id : null
  // Only while the person is actually looking. Marking it read in a tab nobody is
  // watching meant a message arriving in the channel you left open in the
  // background was read the instant it landed: no unread dot, no count in the
  // tab title. It is marked as soon as they come back to the tab.
  const looking = usePageActive()
  // Read through refs: what is read is the latest, and the effect must not re-run
  // (and re-arm its timer) every time someone's presence changes the directory.
  const usersByIdRef = useRef(usersById)
  usersByIdRef.current = usersById
  const newestCreatedAtRef = useRef(null)
  newestCreatedAtRef.current = messages.length ? messages[messages.length - 1].createdAt : null
  useEffect(() => {
    // Not before this conversation's own messages are in: until then there is nothing
    // here to have read, and (before this check) the previous conversation's messages
    // stood in for them, so a chat could be marked read before anything of it was shown.
    if (!profile?.uid || !path || readOnly || !looking || !loaded) return
    if (path.startsWith('users/')) return
    const containerPath = path.replace(/\/messages$/, '')
    // Nothing new since it was last read (the usual case on switching back to a tab).
    const lastRead = usersByIdRef.current?.[profile.uid]?.lastRead?.[pathToReadKey(containerPath)]
    if (!needsMarkRead(newestCreatedAtRef.current, lastRead)) return
    const t = setTimeout(() => {
      markRead(profile.uid, containerPath).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [profile?.uid, path, newestId, readOnly, looking, loaded])

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

  // Stable between renders so the message rows, which are memoised, are not
  // re-rendered just because this component was.
  const onTogglePin = useCallback(async (m) => {
    await setMessagePinned(`${path}/${m.id}`, !m.pinned)
  }, [path])

  // Up arrow in the empty box asks the list to open the last message of mine for editing.
  // `n` makes a second request for the same message count; `focus` puts the cursor back in
  // the box when that edit is over.
  const [editRequest, setEditRequest] = useState(null)
  const [composerFocus, setComposerFocus] = useState(0)
  useEffect(() => { setEditRequest(null) }, [path])
  const editLast = useCallback(() => {
    const m = lastEditableMessage(messages, profile?.uid)
    if (!m) return false
    setEditRequest((r) => ({ id: m.id, n: (r?.n || 0) + 1 }))
    return true
  }, [messages, profile?.uid])

  const onEdit = useCallback(async (m, text) => {
    await editMessageText(`${path}/${m.id}`, text)
  }, [path])

  const onDelete = useCallback(async (m) => {
    await deleteMessage(`${path}/${m.id}`)
  }, [path])

  const myUid = profile?.uid
  const onReact = useCallback(async (m, key) => {
    if (!myUid) return
    await toggleReaction(`${path}/${m.id}`, key, myUid)
  }, [path, myUid])

  const pinned = useMemo(
    () => messages.filter(m => m.pinned).slice().reverse(), // newest pinned first
    [messages]
  )

  const jumpTo = useCallback((id) => {
    setJumpId(null)
    requestAnimationFrame(() => setJumpId(id))
    setPinnedOpen(false)
    setTimeout(() => setJumpId(null), 1500)
  }, [])

  // Following a link to a message (?m=<id>): once this conversation's messages are in, scroll to it
  // and light it up; if it is older than the first page, widen the window ONCE (to LINK_LOOKBACK
  // messages, a single re-read, not page by page); if it is not there after that, say so. Either way
  // the ?m= is removed afterwards, so a refresh or Back does not jump again.
  const [searchParams, setSearchParams] = useSearchParams()
  const linkTarget = messageIdFromSearch(searchParams)
  const [linkNote, setLinkNote] = useState(null)
  useEffect(() => { setLinkNote(null) }, [path])
  useEffect(() => {
    const step = nextLinkStep({ target: linkTarget, loaded, messages, hasMore, limit, loadedLimit: batch.limit })
    if (step === 'none' || step === 'wait') return
    if (step === 'lookback') { setLimit(LINK_LOOKBACK); return }
    if (step === 'jump') jumpTo(linkTarget)
    else setLinkNote("That message isn't here any more. It may have been deleted, or be too old to load.")
    setSearchParams((p) => { const n = new URLSearchParams(p); n.delete(MESSAGE_PARAM); return n }, { replace: true })
  }, [linkTarget, loaded, messages, hasMore, limit, batch.limit, jumpTo, setSearchParams])
  useEffect(() => {
    if (!linkNote) return
    const t = setTimeout(() => setLinkNote(null), 8000)
    return () => clearTimeout(t)
  }, [linkNote])

  // "Copy link" is offered only in channels (messageLink gives null for DMs and notes).
  const hasLinks = messageLink('https://x.example', path, 'a') !== null
  // "Save" keeps a copy in My Notes. Not offered in My Notes itself, nor in a read-only view.
  const inNotes = path.startsWith('users/')
  const saveMessage = useCallback(async (m) => {
    const id = savedNoteId(m.id)
    const payload = savedPayload(m, usersByIdRef.current, path)
    if (!id || !payload || !profile?.uid) return false
    try { return await saveMessageToNotes(profile, id, payload) } catch { return false }
  }, [path, profile])
  const copyLink = useCallback((m) => copyToClipboard(messageLink(window.location.origin, path, m.id)), [path])

  return (
    <main className="relative flex-1 flex flex-col min-w-0 bg-bg-main">
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
            aria-label="Search this chat"
            aria-expanded={searchOpen}
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
            aria-label="Pinned messages"
            aria-expanded={pinnedOpen}
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

        <AppsMenu />

        {headerExtras}
      </header>

      {/* A message that cannot be rendered must not take the header, sidebar and
          composer with it — least of all for an admin who needs to open the
          channel to delete it. */}
      {loadError ? (
        <div role="alert" className="flex-1 grid place-items-center px-6">
          <div className="text-center max-w-md text-ink-muted">
            <div className="text-xl font-semibold text-ink mb-1">Messages couldn't be loaded</div>
            <p className="text-sm">{loadError.message}</p>
            {loadError.retryable && (
              <button
                type="button"
                onClick={() => { setLoadError(null); setReloadKey(k => k + 1) }}
                className="mt-4 px-3 py-1.5 rounded-md bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      ) : (
      <ErrorBoundary resetKey={path} title="This conversation can't be shown">
        <MessageList
          messages={messages}
          newFromId={newFrom?.path === path ? newFrom.id : null}
          loading={!loaded}
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
          onCopyLink={hasLinks ? copyLink : null}
          onForward={readOnly ? null : setForwarding}
          onSave={readOnly || inNotes ? null : saveMessage}
          meUid={profile?.uid}
          scrollToId={jumpId}
          highlightId={jumpId}
          editRequest={editRequest}
          onEditEnded={() => setComposerFocus((n) => n + 1)}
        />
      </ErrorBoundary>
      )}

      {forwarding && (
        <LazySlot overlay title="The forward box couldn't be opened" onDismiss={() => setForwarding(null)}>
          <ForwardDialog message={forwarding} currentPath={path} onClose={() => setForwarding(null)} />
        </LazySlot>
      )}

      {linkNote && (
        <div role="status" className="absolute top-14 left-4 right-4 z-10 px-3 py-2 rounded-md bg-bg-raised border border-line-subtle shadow-elev1 text-sm text-ink-muted flex items-start gap-2">
          <span className="flex-1">{linkNote}</span>
          <button type="button" onClick={() => setLinkNote(null)} className="text-ink-dim hover:text-ink" aria-label="Dismiss">×</button>
        </div>
      )}

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
          draftId={path}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          onEditLast={editLast}
          focusNonce={composerFocus}
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
                  className="text-xs text-brand-text hover:underline shrink-0"
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
