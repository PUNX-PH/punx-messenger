import { useEffect, useMemo, useRef, useState } from 'react'
import Avatar from './Avatar'
import Composer from './Composer'
import Lightbox from './Lightbox'
import { listenReplies } from '../lib/db'
import { useEmojis } from '../lib/emojis'
import { renderMessage } from '../lib/markdown'
import { toDate } from '../lib/messageBlocks'
import { threadReplies, replyLabel } from '../lib/threads'
import { describeListenError } from '../lib/listenError'
import { usePrefs } from '../lib/usePrefs'
import * as tf from '../lib/timeFormat'

// A message and the replies to it, beside the conversation. The replies are read with their own
// query (every reply to this message, not only the ones in the part of the conversation that is
// loaded), and a reply written here goes to the conversation too, quoting this message, as any
// reply does. Reading and replying only: editing, deleting and reacting stay in the conversation.
export default function ThreadPanel({ path, root, usersById, meUid, onSend, onJump, onClose, readOnly = false }) {
  const [{ timeFormat }] = usePrefs()
  const { byName: emojiByName } = useEmojis()
  const [state, setState] = useState({ rootId: null, replies: [], error: null })
  const [zoomed, setZoomed] = useState(null)
  const asideRef = useRef(null)
  const endRef = useRef(null)

  // One listener while a thread is open; another thread (or conversation) replaces it.
  useEffect(() => {
    setState({ rootId: root.id, replies: [], error: null })
    return listenReplies(
      path, root.id,
      (replies) => setState({ rootId: root.id, replies, error: null }),
      (err) => setState({ rootId: root.id, replies: [], error: describeListenError(err) }),
    )
  }, [path, root.id])

  const loaded = state.rootId === root.id
  const replies = useMemo(() => (loaded ? threadReplies(state.replies, root.id) : []), [loaded, state.replies, root.id])

  // New replies come in at the bottom, and the panel follows them.
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [replies.length, root.id])

  const sendReply = (m) => onSend({ ...m, replyTo: root })

  return (
    <aside
      ref={asideRef}
      aria-label="Thread"
      data-thread-panel
      onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose() }}
      className="absolute inset-0 z-30 md:relative md:inset-auto md:w-[360px] md:shrink-0 flex flex-col min-w-0 bg-bg-main border-l border-line-subtle"
    >
      <header className="h-12 border-b border-line-subtle flex items-center px-3 gap-2 shadow-elev1 shrink-0">
        <div className="font-semibold text-ink flex-1 min-w-0 truncate">Thread</div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-dim hover:text-ink p-1.5 rounded hover:bg-bg-hover"
          title="Close thread"
          aria-label="Close thread"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <Entry message={root} usersById={usersById} emojiByName={emojiByName} timeFormat={timeFormat} onZoom={setZoomed} root />
        <div className="flex items-center gap-2 text-xs text-ink-dim" data-thread-count>
          <span>{loaded ? (replies.length ? replyLabel(replies.length) : 'No replies yet') : 'Loading…'}</span>
          <span className="flex-1 border-t border-line-subtle" />
        </div>
        {state.error && (
          <div role="alert" className="text-sm text-bad bg-bad/10 border border-bad/20 rounded px-2 py-1">
            {state.error.message}
          </div>
        )}
        {replies.map(m => (
          <Entry
            key={m.id}
            message={m}
            usersById={usersById}
            emojiByName={emojiByName}
            timeFormat={timeFormat}
            onZoom={setZoomed}
            onJump={onJump}
            mine={m.author?.uid === meUid}
          />
        ))}
        {loaded && !state.error && replies.length === 0 && !readOnly && (
          <div className="text-sm text-ink-muted">Write the first reply below.</div>
        )}
        <div ref={endRef} />
      </div>

      {!readOnly && (
        <Composer
          placeholder="Reply in thread"
          onSend={sendReply}
          draftId={`${path}#thread:${root.id}`}
          dropZoneRef={asideRef}
        />
      )}
      <Lightbox src={zoomed} onClose={() => setZoomed(null)} />
    </aside>
  )
}

function Entry({ message, usersById, emojiByName, timeFormat, onZoom, onJump = null, root = false, mine = false }) {
  const u = usersById?.[message.author?.uid]
  const name = u?.name || message.author?.name || 'Unknown'
  const when = toDate(message.createdAt)
  const hasVoice = typeof message.audioURL === 'string' && message.audioURL !== ''
  return (
    <div className={'flex gap-2.5 ' + (root ? 'pb-1' : '')} data-thread-entry={root ? 'root' : 'reply'}>
      <Avatar name={name} src={u?.photoURL || message.author?.photoURL} size={root ? 36 : 28} ringColor="border-bg-main" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-ink truncate">{name}</span>
          {when && <span className="text-xs text-ink-dim" title={tf.fullTime(when, timeFormat)}>{tf.headerTime(when, timeFormat)}</span>}
          {onJump && (
            <button type="button" onClick={() => onJump(message.id)} className="ml-auto text-[11px] text-ink-dim hover:text-ink" title="Show in the conversation">
              Show in chat
            </button>
          )}
        </div>
        <div className="text-ink leading-relaxed break-words">
          {message.imageURL && (
            <button type="button" onClick={() => onZoom(message.imageURL)} className="block my-1 rounded-md overflow-hidden border border-line-subtle hover:border-line-strong" title="Click to expand">
              <img src={message.imageURL} alt="" className="max-w-full max-h-56 object-contain bg-bg-deepest" />
            </button>
          )}
          {hasVoice && <div className="text-sm text-ink-muted">🎤 Voice message</div>}
          {message.text && <div className="whitespace-pre-wrap">{renderMessage(message.text, { emojiByName, usersById, emojiSize: 22 })}</div>}
          {message.editedAt && <span className="text-[10px] text-ink-dim">(edited)</span>}
        </div>
      </div>
    </div>
  )
}
