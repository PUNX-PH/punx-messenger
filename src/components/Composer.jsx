import { useEffect, useMemo, useRef, useState } from 'react'
import EmojiPicker from './EmojiPicker'
import Avatar from './Avatar'
import { useUsers } from '../lib/users'
import { useAuth } from '../lib/auth'
import { resolveMentions } from '../lib/markdown'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export default function Composer({
  placeholder = 'Message', onSend, disabled, onTyping,
  replyingTo = null, onCancelReply,
}) {
  const { profile } = useAuth()
  const { users } = useUsers()
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mention, setMention] = useState(null) // { startIdx, query, selectedIdx }
  const fileRef = useRef(null)
  const taRef = useRef(null)
  const emojiBtnRef = useRef(null)

  // Mentions the user has explicitly picked in this composition
  // (map of "@Name" chunk → uid). Applied at send time to convert visible
  // names into <@uid> tokens.
  const mentionHintsRef = useRef(new Map())

  // Typing state — throttled writes + auto-clear
  const typingActiveRef = useRef(false)
  const lastTypingWriteRef = useRef(0)
  const stopTimerRef = useRef(null)

  const pingTyping = () => {
    if (!onTyping) return
    const now = Date.now()
    if (now - lastTypingWriteRef.current > 3000) {
      lastTypingWriteRef.current = now
      typingActiveRef.current = true
      onTyping(true)
    }
    clearTimeout(stopTimerRef.current)
    stopTimerRef.current = setTimeout(() => {
      if (typingActiveRef.current) {
        typingActiveRef.current = false
        lastTypingWriteRef.current = 0
        onTyping(false)
      }
    }, 5000)
  }

  const stopTypingNow = () => {
    clearTimeout(stopTimerRef.current)
    if (typingActiveRef.current && onTyping) {
      typingActiveRef.current = false
      lastTypingWriteRef.current = 0
      onTyping(false)
    }
  }

  // Clean up typing on unmount (switch channels/DMs, sign out, etc.)
  useEffect(() => () => stopTypingNow(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const insertAtCursor = (token) => {
    const ta = taRef.current
    if (!ta) { setText(t => t + token); return }
    const start = ta.selectionStart ?? text.length
    const end = ta.selectionEnd ?? text.length
    const next = text.slice(0, start) + token + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + token.length
      ta.setSelectionRange(pos, pos)
    })
  }

  // ---------- @mention autocomplete ----------
  const mentionCandidates = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return users
      .filter(u => u.id !== profile?.id)
      .filter(u => !q
        || u.name?.toLowerCase().includes(q)
        || u.email?.toLowerCase().split('@')[0].includes(q))
      .slice(0, 8)
  }, [mention, users, profile?.id])

  const detectMention = (value, cursor) => {
    if (cursor == null) { setMention(null); return }
    const before = value.slice(0, cursor)
    // Match @ followed by up to 30 word chars (no spaces). Must be at start of
    // line, or after whitespace.
    const m = /(^|\s)@([\w-]{0,30})$/.exec(before)
    if (!m) { setMention(null); return }
    const startIdx = m.index + m[1].length // position of '@'
    setMention(prev => {
      const same = prev && prev.startIdx === startIdx && prev.query === m[2]
      return same ? prev : { startIdx, query: m[2], selectedIdx: 0 }
    })
  }

  const onTextChange = (e) => {
    const v = e.target.value
    setText(v)
    detectMention(v, e.target.selectionStart)
    if (v.trim().length > 0) pingTyping()
    else stopTypingNow()
  }

  const pickMention = (user) => {
    if (!mention || !user) return
    const before = text.slice(0, mention.startIdx)
    const after = text.slice(mention.startIdx + 1 + mention.query.length)
    // Visible chunk uses the user's display name; at send time we resolve it
    // back to <@uid> via mentionHintsRef + a fallback exact-name match.
    const chunk = `@${user.name}`
    mentionHintsRef.current.set(chunk, user.id)
    const inserted = chunk + ' '
    const next = before + inserted + after
    setText(next)
    setMention(null)
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length
      taRef.current?.focus()
      taRef.current?.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const accept = (f) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { setError('Only image files for now.'); return }
    if (f.size > MAX_BYTES) { setError('Image must be under 10 MB.'); return }
    setError(null)
    setFile(f)
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    if (sending || disabled) return
    if (!text.trim() && !file) return
    setSending(true); setError(null)
    stopTypingNow()
    try {
      const resolved = resolveMentions(text.trim(), users, mentionHintsRef.current)
      await onSend({ text: resolved, imageFile: file })
      setText(''); setFile(null)
      mentionHintsRef.current.clear()
      taRef.current?.focus()
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Failed to send.')
    } finally {
      setSending(false)
    }
  }

  // Paste image from clipboard
  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
    if (item) {
      const f = item.getAsFile()
      if (f) { e.preventDefault(); accept(f) }
    }
  }

  // Drag-drop onto textarea
  const onDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) accept(f)
  }

  return (
    <form onSubmit={submit} className="px-3 md:px-4 pb-safe pt-1">
      {replyingTo && (
        <div className="mb-1.5 flex items-center gap-2 bg-bg-raised/70 border border-line-subtle rounded-md px-3 py-1.5 text-xs">
          <span className="text-ink-dim">Replying to</span>
          <span className="text-brand font-medium">@{replyingTo.author?.name || 'someone'}</span>
          <span className="text-ink-dim truncate flex-1 min-w-0">
            {replyingTo.text || (replyingTo.imageURL ? '[image]' : '')}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-ink-dim hover:text-ink p-0.5"
            title="Cancel reply"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {error && (
        <div className="mb-2 text-xs text-bad bg-bad/10 border border-bad/20 rounded px-2 py-1">
          {error}
        </div>
      )}

      {preview && (
        <div className="mb-2 inline-flex items-center gap-2 bg-bg-raised border border-line-subtle rounded-md p-2">
          <img src={preview} alt="" className="w-14 h-14 object-cover rounded" />
          <div className="text-xs text-ink-muted">
            <div className="truncate max-w-[180px] text-ink">{file?.name}</div>
            <div>{formatBytes(file?.size)}</div>
          </div>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="text-ink-dim hover:text-bad p-1"
            title="Remove"
          >
            <XIcon />
          </button>
        </div>
      )}

      <div
        className="bg-bg-raised border border-line-subtle rounded-lg flex items-end gap-1.5 pl-2 pr-2.5 py-1.5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Attach image"
          className="text-ink-dim hover:text-ink p-1.5 transition-colors shrink-0"
        >
          <PlusIcon />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
        <div className="relative flex-1">
          {mention && mentionCandidates.length > 0 && (
            <MentionDropdown
              items={mentionCandidates}
              selectedIdx={mention.selectedIdx}
              onPick={pickMention}
              onHover={(idx) => setMention(m => m ? { ...m, selectedIdx: idx } : m)}
            />
          )}
          <textarea
            ref={taRef}
            value={text}
            onChange={onTextChange}
            onClick={(e) => detectMention(text, e.target.selectionStart)}
            onKeyUp={(e) => {
              if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
                detectMention(text, e.target.selectionStart)
              }
            }}
            onInput={(e) => {
              // auto-grow up to max-h
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
            }}
            onPaste={onPaste}
            onKeyDown={e => {
              if (mention && mentionCandidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMention(m => ({ ...m, selectedIdx: Math.min(m.selectedIdx + 1, mentionCandidates.length - 1) }))
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMention(m => ({ ...m, selectedIdx: Math.max(m.selectedIdx - 1, 0) }))
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  pickMention(mentionCandidates[mention.selectedIdx])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setMention(null)
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
            rows={1}
            placeholder={sending ? 'Uploading…' : placeholder}
            disabled={disabled || sending}
            className="w-full bg-transparent text-ink placeholder:text-ink-dim resize-none outline-none max-h-40 leading-6 py-1.5 disabled:opacity-50 align-middle"
          />
        </div>
        <div className="relative shrink-0">
          <button
            ref={emojiBtnRef}
            type="button"
            onClick={() => setEmojiOpen(o => !o)}
            title="Emoji"
            className={[
              'p-1.5 transition-colors',
              emojiOpen ? 'text-ink' : 'text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            <SmileyIcon />
          </button>
          <EmojiPicker
            anchorRef={emojiBtnRef}
            open={emojiOpen}
            onClose={() => setEmojiOpen(false)}
            onPick={insertAtCursor}
          />
        </div>

        <button
          type="submit"
          disabled={(!text.trim() && !file) || sending || disabled}
          className="text-brand disabled:text-ink-dim hover:text-brand-hover transition-colors p-1.5 disabled:cursor-not-allowed shrink-0"
          title="Send"
        >
          {sending ? <SpinnerIcon /> : <SendIcon />}
        </button>
      </div>
    </form>
  )
}

function MentionDropdown({ items, selectedIdx, onPick, onHover }) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 overflow-hidden z-30">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-dim font-semibold border-b border-line-subtle bg-bg-deepest">
        Mention a teammate
      </div>
      <div className="max-h-64 overflow-y-auto scrollbar-thin">
        {items.map((u, idx) => (
          <button
            key={u.id}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onPick(u) }}
            onMouseEnter={() => onHover?.(idx)}
            className={[
              'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
              idx === selectedIdx ? 'bg-bg-hover text-ink' : 'text-ink-muted hover:bg-bg-hover hover:text-ink',
            ].join(' ')}
          >
            <Avatar name={u.name} src={u.photoURL} size={24} />
            <span className="text-sm truncate flex-1">{u.name}</span>
            <span className="text-[10px] text-ink-dim truncate">{u.email}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SmileyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
      <line x1="9" y1="9" x2="9.01" y2="9"/>
      <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  )
}
function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 11l18-8-8 18-2-8-8-2z"/>
    </svg>
  )
}
function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}
function formatBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function SpinnerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25"/>
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/>
      </path>
    </svg>
  )
}
