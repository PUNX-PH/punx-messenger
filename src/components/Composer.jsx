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
  const [pickerTab, setPickerTab] = useState('emoji')
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

  // Two trigger buttons share one popover — clicking the same button again
  // while its tab is already showing closes it; clicking the other one just
  // re-targets the open popover to that tab instead of closing/reopening.
  const openPicker = (tab) => {
    if (emojiOpen && pickerTab === tab) { setEmojiOpen(false); return }
    setPickerTab(tab)
    setEmojiOpen(true)
  }

  // Picking a GIF sends it immediately (Discord-style), not inserted as text.
  const sendGif = async (url, meta) => {
    setEmojiOpen(false)
    if (sending || disabled) return
    setSending(true); setError(null)
    try {
      await onSend({ text: '', imageURL: url, imageMeta: meta })
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Failed to send.')
    } finally {
      setSending(false)
    }
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
        <div ref={emojiBtnRef} className="relative shrink-0 flex items-center">
          <button
            type="button"
            onClick={() => openPicker('gif')}
            title="GIF"
            className={[
              'p-1.5 transition-colors',
              emojiOpen && pickerTab === 'gif' ? 'text-ink' : 'text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            <GifIcon />
          </button>
          <button
            type="button"
            onClick={() => openPicker('emoji')}
            title="Emoji"
            className={[
              'p-1.5 transition-colors',
              emojiOpen && pickerTab === 'emoji' ? 'text-ink' : 'text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            <SmileyIcon />
          </button>
          <EmojiPicker
            anchorRef={emojiBtnRef}
            open={emojiOpen}
            onClose={() => setEmojiOpen(false)}
            onPick={insertAtCursor}
            onPickGif={sendGif}
            initialTab={pickerTab}
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

function GifIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M17 5H7C4.79086 5 3 6.79086 3 9V15C3 17.2091 4.79086 19 7 19H17C19.2091 19 21 17.2091 21 15V9C21 6.79086 19.2091 5 17 5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9.42932 9.83956C9.82451 9.96364 10.2455 9.74387 10.3696 9.34868C10.4936 8.95349 10.2739 8.53253 9.87868 8.40845L9.42932 9.83956ZM8.842 9L8.84112 8.25C8.83449 8.25001 8.82786 8.25011 8.82123 8.25029L8.842 9ZM6 12L6.74974 12.0198C6.75009 12.0066 6.75009 11.9934 6.74974 11.9802L6 12ZM8.842 15L8.82123 15.7497C8.82786 15.7499 8.83449 15.75 8.84112 15.75L8.842 15ZM9.654 14.876L9.87868 15.5916C9.88376 15.59 9.88881 15.5883 9.89385 15.5866L9.654 14.876ZM11.684 12L12.4339 11.988C12.4274 11.5785 12.0935 11.25 11.684 11.25V12ZM8.842 11.25C8.42779 11.25 8.092 11.5858 8.092 12C8.092 12.4142 8.42779 12.75 8.842 12.75V11.25ZM12.829 15C12.829 15.4142 13.1648 15.75 13.579 15.75C13.9932 15.75 14.329 15.4142 14.329 15H12.829ZM14.329 9C14.329 8.58579 13.9932 8.25 13.579 8.25C13.1648 8.25 12.829 8.58579 12.829 9H14.329ZM15.987 15C15.987 15.4142 16.3228 15.75 16.737 15.75C17.1512 15.75 17.487 15.4142 17.487 15H15.987ZM17.487 11.667C17.487 11.2528 17.1512 10.917 16.737 10.917C16.3228 10.917 15.987 11.2528 15.987 11.667H17.487ZM15.987 11.667C15.987 12.0812 16.3228 12.417 16.737 12.417C17.1512 12.417 17.487 12.0812 17.487 11.667H15.987ZM16.737 10.333H17.487C17.487 10.3266 17.4869 10.3201 17.4868 10.3137L16.737 10.333ZM18.0211 9.74971C18.4351 9.73805 18.7614 9.39295 18.7497 8.9789C18.7381 8.56486 18.393 8.23865 17.9789 8.2503L18.0211 9.74971ZM16.737 12.417C17.1512 12.417 17.487 12.0812 17.487 11.667C17.487 11.2528 17.1512 10.917 16.737 10.917V12.417ZM15.474 10.917C15.0598 10.917 14.724 11.2528 14.724 11.667C14.724 12.0812 15.0598 12.417 15.474 12.417V10.917ZM16.737 10.917C16.3228 10.917 15.987 11.2528 15.987 11.667C15.987 12.0812 16.3228 12.417 16.737 12.417V10.917ZM18 12.417C18.4142 12.417 18.75 12.0812 18.75 11.667C18.75 11.2528 18.4142 10.917 18 10.917V12.417ZM9.87868 8.40845C9.54293 8.30302 9.19303 8.24959 8.84112 8.25L8.84288 9.75C9.04178 9.74977 9.23955 9.77997 9.42932 9.83956L9.87868 8.40845ZM8.82123 8.25029C6.79481 8.30643 5.19679 9.99329 5.25026 12.0198L6.74974 11.9802C6.7181 10.7811 7.66369 9.78294 8.86277 9.74971L8.82123 8.25029ZM5.25026 11.9802C5.19679 14.0067 6.79481 15.6936 8.82123 15.7497L8.86277 14.2503C7.66369 14.2171 6.7181 13.2189 6.74974 12.0198L5.25026 11.9802ZM8.84112 15.75C9.19303 15.7504 9.54293 15.697 9.87868 15.5916L9.42932 14.1604C9.23955 14.22 9.04178 14.2502 8.84288 14.25L8.84112 15.75ZM9.89385 15.5866C11.433 15.0671 12.4599 13.6123 12.4339 11.988L10.9341 12.012C10.9496 12.984 10.3352 13.8545 9.41415 14.1654L9.89385 15.5866ZM11.684 11.25H8.842V12.75H11.684V11.25ZM14.329 15V9H12.829V15H14.329ZM17.487 15V11.667H15.987V15H17.487ZM17.487 11.667V10.333H15.987V11.667H17.487ZM17.4868 10.3137C17.4789 10.0105 17.718 9.75824 18.0211 9.74971L17.9789 8.2503C16.849 8.28209 15.9581 9.22241 15.9872 10.3523L17.4868 10.3137ZM16.737 10.917H15.474V12.417H16.737V10.917ZM16.737 12.417H18V10.917H16.737V12.417Z" fill="currentColor"/>
    </svg>
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
