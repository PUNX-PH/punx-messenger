import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import LazySlot from './LazySlot'
import { EmojiPicker } from '../lib/lazyParts'
import Avatar from './Avatar'
import AttachmentTray from './AttachmentTray'
import { useUsers } from '../lib/users'
import { useAuth } from '../lib/auth'
import { resolveMentions } from '../lib/markdown'
import { drafts } from '../lib/drafts'
import { usePrefs } from '../lib/usePrefs'
import { shouldSend } from '../lib/sendKey'
import { hideSpoilers } from '../lib/spoilers'
import { shouldEditLast } from '../lib/editLast'
import { useEmojis } from '../lib/emojis'
import { MAX_VOICE_MS, formatDuration, voiceErrorText } from '../lib/voiceMessage'
import { canRecord, finishRecording, startRecording } from '../lib/voiceRecorder'
import { applySuggestion, detectEmojiQuery, suggestEmojis } from '../lib/emojiSuggest'
import { MAX_FILES, addAttachments, dragHasFiles, filesOf, pastedImages, remainingAfter, sendAttachments, uploadingText } from '../lib/attachments'

export default function Composer({
  placeholder = 'Message', onSend, disabled, onTyping,
  replyingTo = null, onCancelReply,
  // Which conversation this box is for (its path). The box stays mounted as you
  // move between conversations, so what is typed has to be kept per conversation,
  // or it follows you into the next one and gets sent there.
  draftId = null,
  // Up arrow in an empty box: start editing the last message. Returns true when there was one.
  onEditLast = null,
  // Bumped to put the cursor back in the box (after an edit started from here ends).
  focusNonce = 0,
  // The element a picture can be dropped on: the whole conversation, not just the box.
  dropZoneRef = null,
}) {
  const { profile } = useAuth()
  const [{ sendKey }] = usePrefs()
  // Only active accounts — both for the @-picker and for resolving a typed
  // mention, so a removed teammate can't be pinged by name.
  const { activeUsers: users } = useUsers()
  const draftKey = profile?.uid && draftId ? `${profile.uid}:${draftId}` : null
  const keyRef = useRef(draftKey)
  const [text, setText] = useState(() => drafts.get(draftKey))
  // Every change to the text goes through here, so the draft is always current.
  const updateText = (v) => { setText(v); drafts.set(keyRef.current, v) }
  // The pictures waiting to be sent, in the order they were chosen. filesRef is the same list,
  // for the drop handler, which outlives a render.
  const [files, setFilesState] = useState([])
  const filesRef = useRef([])
  const setFiles = (next) => { filesRef.current = next; setFilesState(next) }
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 }) // which picture is going, of how many
  const [dragging, setDragging] = useState(false) // pictures are being dragged over the conversation
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState('emoji')
  const [mention, setMention] = useState(null) // { startIdx, query, selectedIdx }
  const [emojiSug, setEmojiSug] = useState(null) // { startIdx, query, selectedIdx }: ":fir" typed, suggestions showing
  const { emojis: customEmojis } = useEmojis()
  // Recording a voice message: null, or { phase: 'starting' | 'recording' | 'sending', ms }.
  const [voice, setVoice] = useState(null)
  const recRef = useRef(null)          // the live recording (its microphone is on)
  const sendVoiceRef = useRef(null)     // the latest sendVoice, for the time limit to call
  const micOk = useMemo(() => typeof window !== 'undefined' && canRecord(window), [])
  const fileRef = useRef(null)
  const taRef = useRef(null)
  const emojiBtnRef = useRef(null)
  useEffect(() => { if (focusNonce) taRef.current?.focus() }, [focusNonce])

  // Mentions the user has explicitly picked in this composition
  // (map of "@Name" chunk → uid). Applied at send time to convert visible
  // names into <@uid> tokens.
  const mentionHintsRef = useRef(new Map())

  // Typing state — throttled writes + auto-clear
  const typingActiveRef = useRef(false)
  // Where "I am typing" was last written. Remembered because the callback prop
  // changes when you switch conversation, and clearing the marker must go to the
  // conversation you were typing in, not the one you opened.
  const typingSinkRef = useRef(null)
  const lastTypingWriteRef = useRef(0)
  const stopTimerRef = useRef(null)

  const pingTyping = () => {
    if (!onTyping) return
    const now = Date.now()
    if (now - lastTypingWriteRef.current > 3000) {
      lastTypingWriteRef.current = now
      typingActiveRef.current = true
      typingSinkRef.current = onTyping
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
    const sink = typingSinkRef.current
    if (typingActiveRef.current && sink) {
      typingActiveRef.current = false
      lastTypingWriteRef.current = 0
      sink(false)
    }
  }

  // Moving to another conversation: stop "typing" in the one left, then show what
  // was last typed in the new one (nothing, if nothing was), with no leftover
  // attachment, error or half-picked mention from the old one.
  useEffect(() => {
    if (keyRef.current === draftKey) return
    stopTypingNow()
    keyRef.current = draftKey
    setText(drafts.get(draftKey))
    setFiles([])
    setError(null)
    setMention(null)
    setEmojiSug(null)
    cancelVoice() // a recording belongs to the conversation it was started in
    mentionHintsRef.current.clear()
  }, [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // The box is as tall as what is in it (up to a limit). Done whenever the text
  // changes, not only when someone types, so a draft put back, or a box emptied by
  // moving to another conversation, is the right height too.
  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [text])

  // Clean up typing on unmount (switch channels/DMs, sign out, etc.)
  useEffect(() => () => stopTypingNow(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const insertAtCursor = (token) => {
    const ta = taRef.current
    if (!ta) { updateText(text + token); return }
    const start = ta.selectionStart ?? text.length
    const end = ta.selectionEnd ?? text.length
    const next = text.slice(0, start) + token + text.slice(end)
    updateText(next)
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

  // ---------- voice messages ----------
  // Whatever way a recording ends, the microphone is released (see voiceRecorder.js).
  function cancelVoice() {
    recRef.current?.cancel()
    recRef.current = null
    setVoice(null)
  }
  useEffect(() => () => { recRef.current?.cancel(); recRef.current = null }, []) // leaving the screen with the microphone on

  const startVoice = async () => {
    if (voice || sending || disabled) return
    setError(null)
    setVoice({ phase: 'starting', ms: 0 })
    try {
      recRef.current = await startRecording(window, {
        onTick: (ms) => setVoice(v => (v && v.phase === 'recording' ? { ...v, ms } : v)),
        onLimit: () => sendVoiceRef.current?.(),
      })
      setVoice({ phase: 'recording', ms: 0 })
    } catch (err) {
      setVoice(null)
      setError(voiceErrorText(err?.code))
    }
  }

  const sendVoice = async () => {
    const rec = recRef.current
    if (!rec) return
    recRef.current = null
    const sentKey = keyRef.current
    setVoice({ phase: 'sending', ms: 0 })
    try {
      const audio = await finishRecording(rec, window)
      if (keyRef.current !== sentKey) return // moved to another conversation meanwhile: it is not for this one
      await onSend({ text: '', audio })
    } catch (err) {
      if (err?.code !== 'cancelled') { console.error(err); setError(err?.code ? voiceErrorText(err.code) : (err?.message || 'Failed to send.')) }
    } finally {
      setVoice(null)
    }
  }
  sendVoiceRef.current = sendVoice

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

  // ---------- :emoji: suggestions ----------
  const emojiCandidates = useMemo(
    () => (emojiSug ? suggestEmojis(emojiSug.query, { custom: customEmojis }) : []),
    [emojiSug, customEmojis],
  )
  const suggestOpen = !!emojiSug && emojiCandidates.length > 0 // (the picker button has its own `emojiOpen`)

  const detectEmoji = (value, cursor) => {
    const d = detectEmojiQuery(value, cursor)
    if (!d) { setEmojiSug(null); return }
    setEmojiSug(prev => (prev && prev.startIdx === d.startIdx && prev.query === d.query ? prev : { ...d, selectedIdx: 0 }))
  }

  const pickEmoji = (item) => {
    if (!emojiSug || !item) return
    const { text: next, caret } = applySuggestion(text, emojiSug.startIdx, emojiSug.query, item)
    updateText(next)
    setEmojiSug(null)
    requestAnimationFrame(() => {
      taRef.current?.focus()
      taRef.current?.setSelectionRange(caret, caret)
    })
  }

  const onTextChange = (e) => {
    const v = e.target.value
    updateText(v)
    detectMention(v, e.target.selectionStart)
    detectEmoji(v, e.target.selectionStart)
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
    updateText(next)
    setMention(null)
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length
      taRef.current?.focus()
      taRef.current?.setSelectionRange(pos, pos)
    })
  }

  // Put more pictures in the tray (picked, pasted or dropped). While one is going out the list is
  // not touched: what is left after it is worked out from the list that was sent.
  const attach = (incoming) => {
    if (sending || disabled || voice) return
    const r = addAttachments(filesRef.current, incoming)
    setFiles(r.files)
    setError(r.problem)
  }
  const attachRef = useRef(attach)
  attachRef.current = attach

  // Dropping pictures anywhere on the conversation, with a cue while they are over it.
  useEffect(() => {
    const el = dropZoneRef?.current
    if (!el || disabled) return
    let depth = 0 // dragenter/dragleave fire for every child, so count in and out
    const reset = () => { depth = 0; setDragging(false) }
    const enter = (e) => { if (!dragHasFiles(e.dataTransfer)) return; e.preventDefault(); depth++; setDragging(true) }
    const over = (e) => { if (!dragHasFiles(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
    const leave = (e) => { if (!dragHasFiles(e.dataTransfer)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false) }
    const drop = (e) => { if (!dragHasFiles(e.dataTransfer)) return; e.preventDefault(); reset(); attachRef.current(filesOf(e.dataTransfer)) }
    el.addEventListener('dragenter', enter)
    el.addEventListener('dragover', over)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    // A drag that ends elsewhere (Esc, dropped outside) must not leave the cue up.
    window.addEventListener('dragend', reset)
    window.addEventListener('drop', reset)
    return () => {
      el.removeEventListener('dragenter', enter)
      el.removeEventListener('dragover', over)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', drop)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('drop', reset)
      reset()
    }
  }, [dropZoneRef, disabled])

  const submit = async (e) => {
    e?.preventDefault?.()
    if (sending || disabled) return
    if (!text.trim() && files.length === 0) return
    setSending(true); setError(null)
    setProgress({ done: 0, total: files.length })
    stopTypingNow()
    // Which conversation this message is for. If you moved to another while it was
    // sending, the box now belongs to that one and must not be emptied.
    const sentKey = keyRef.current
    try {
      const resolved = resolveMentions(text.trim(), users, mentionHintsRef.current)
      const sentFiles = files
      const { sent, error: failure } = await sendAttachments({
        text: resolved,
        files: sentFiles,
        send: onSend,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      // The text goes with the first message, so once anything has gone it is spent. If nothing
      // went, all of it is kept for another try.
      if (sent > 0) drafts.clear(sentKey)
      if (keyRef.current !== sentKey) return
      if (failure) {
        if (sent > 0) { setText(''); setFiles(remainingAfter(sentFiles, sent)) }
        throw sentFiles.length > 1 && sent > 0 ? new Error(`Sent ${sent} of ${sentFiles.length}. ${failure?.message || 'Failed to send.'}`) : failure
      }
      setText(''); setFiles([]); setEmojiSug(null)
      // The box grows with what is typed and only ever shrinks on input, so
      // after a long message it stayed tall around an empty field.
      if (taRef.current) taRef.current.style.height = 'auto'
      mentionHintsRef.current.clear()
      taRef.current?.focus()
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Failed to send.')
    } finally {
      setSending(false)
    }
  }

  // Paste pictures from the clipboard (text pasted with them is left alone).
  const onPaste = (e) => {
    const pics = pastedImages(e.clipboardData)
    if (pics.length) { e.preventDefault(); attach(pics) }
  }

  return (
    <form onSubmit={submit} className="px-3 md:px-4 pb-safe pt-1">
      {replyingTo && (
        <div className="mb-1.5 flex items-center gap-2 bg-bg-raised/70 border border-line-subtle rounded-md px-3 py-1.5 text-xs">
          <span className="text-ink-dim">Replying to</span>
          <span className="text-brand-text font-medium">@{replyingTo.author?.name || 'someone'}</span>
          <span className="text-ink-dim truncate flex-1 min-w-0">
            {hideSpoilers(replyingTo.text) || (replyingTo.imageURL ? '[image]' : '')}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-ink-dim hover:text-ink p-0.5"
            title="Cancel reply"
            aria-label="Cancel reply"
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

      <AttachmentTray files={files} busy={sending} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />

      <div
        className="bg-bg-raised border border-line-subtle rounded-lg flex items-end gap-1.5 pl-2 pr-2.5 py-1.5"
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Attach images"
          aria-label="Attach images"
          className="text-ink-dim hover:text-ink p-1.5 transition-colors shrink-0"
        >
          <PlusIcon />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { attach(Array.from(e.target.files || [])); e.target.value = '' }}
        />
        {voice && (
          <div className="flex-1 flex items-center gap-3 py-1.5 min-w-0" role="status" aria-live="polite">
            {voice.phase === 'recording' ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-bad animate-pulse shrink-0" aria-hidden="true" />
                <span className="text-sm tabular-nums">{formatDuration(voice.ms)} / {formatDuration(MAX_VOICE_MS)}</span>
                <span className="text-xs text-ink-dim truncate">Recording a voice message</span>
              </>
            ) : (
              <span className="text-sm text-ink-muted">{voice.phase === 'starting' ? 'Waiting for the microphone…' : 'Sending…'}</span>
            )}
          </div>
        )}
        <div className={'relative flex-1' + (voice ? ' hidden' : '')}>
          {suggestOpen && (
            <EmojiSuggestDropdown
              query={emojiSug.query}
              items={emojiCandidates}
              selectedIdx={Math.min(emojiSug.selectedIdx, emojiCandidates.length - 1)}
              onPick={pickEmoji}
              onHover={(idx) => setEmojiSug(m => m ? { ...m, selectedIdx: idx } : m)}
            />
          )}
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
            onClick={(e) => { detectMention(text, e.target.selectionStart); detectEmoji(text, e.target.selectionStart) }}
            onKeyUp={(e) => {
              if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
                detectMention(text, e.target.selectionStart)
                detectEmoji(text, e.target.selectionStart)
              }
            }}
            onInput={(e) => {
              // auto-grow up to max-h
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
            }}
            onPaste={onPaste}
            onKeyDown={e => {
              if (suggestOpen) {
                const last = emojiCandidates.length - 1
                const at = Math.min(emojiSug.selectedIdx, last)
                if (e.key === 'ArrowDown') { e.preventDefault(); setEmojiSug(m => ({ ...m, selectedIdx: Math.min(at + 1, last) })); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setEmojiSug(m => ({ ...m, selectedIdx: Math.max(at - 1, 0) })); return }
                if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) { e.preventDefault(); pickEmoji(emojiCandidates[at]); return }
                if (e.key === 'Escape') { e.preventDefault(); setEmojiSug(null); return }
              }
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
              if (onEditLast && shouldEditLast(e, { text, hasFile: files.length > 0, mentionOpen: !!(mention && mentionCandidates.length > 0) || suggestOpen })) {
                if (onEditLast()) e.preventDefault()
                return
              }
              // Which key sends is the person's choice (preferences); isComposing is
              // handled inside, so Enter confirming an IME candidate never also sends.
              if (shouldSend(e, sendKey)) { e.preventDefault(); submit() }
            }}
            rows={1}
            placeholder={sending ? uploadingText(progress.done, progress.total) : placeholder}
            disabled={disabled}
            // readOnly, not disabled, while sending: a disabled field cannot take
            // focus, so the refocus after a send did nothing and the next message
            // needed a click first. submit() already refuses a second send.
            readOnly={sending}
            className="w-full bg-transparent text-ink placeholder:text-ink-dim resize-none outline-none max-h-40 leading-6 py-1.5 disabled:opacity-50 align-middle"
          />
        </div>
        <div ref={emojiBtnRef} className={'relative shrink-0 flex items-center' + (voice ? ' hidden' : '')}>
          <button
            type="button"
            onClick={() => openPicker('gif')}
            title="GIF"
            aria-label="GIF"
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
            aria-label="Emoji"
            className={[
              'p-1.5 transition-colors',
              emojiOpen && pickerTab === 'emoji' ? 'text-ink' : 'text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            <SmileyIcon />
          </button>
          {emojiOpen && (
            <LazySlot overlay onDismiss={() => setEmojiOpen(false)}>
              <EmojiPicker
                anchorRef={emojiBtnRef}
                open
                onClose={() => setEmojiOpen(false)}
                onPick={insertAtCursor}
                onPickGif={sendGif}
                initialTab={pickerTab}
              />
            </LazySlot>
          )}
        </div>

        {voice ? (
          <>
            <button type="button" onClick={cancelVoice} disabled={voice.phase === 'sending'} title="Cancel recording" aria-label="Cancel recording" className="text-ink-dim hover:text-bad transition-colors p-1.5 shrink-0 disabled:opacity-50">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
            <button type="button" onClick={sendVoice} disabled={voice.phase !== 'recording'} title="Send voice message" aria-label="Send voice message" className="text-brand-text hover:text-ink transition-colors p-1.5 shrink-0 disabled:text-ink-dim disabled:cursor-not-allowed">
              <SendIcon />
            </button>
          </>
        ) : micOk && !text.trim() && files.length === 0 && !sending && !disabled ? (
          <button type="button" onClick={startVoice} title="Record a voice message" aria-label="Record a voice message" className="text-ink-dim hover:text-ink transition-colors p-1.5 shrink-0">
            <MicIcon />
          </button>
        ) : (
        <button
          type="submit"
          disabled={(!text.trim() && files.length === 0) || sending || disabled}
          className="text-brand-text disabled:text-ink-dim hover:text-ink transition-colors p-1.5 disabled:cursor-not-allowed shrink-0"
          title="Send"
          aria-label="Send"
        >
          {sending ? <SpinnerIcon /> : <SendIcon />}
        </button>
        )}
      </div>
      {dragging && dropZoneRef?.current && createPortal(
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-bg-main/80 backdrop-blur-[1px]" data-drop-cue>
          <div className="rounded-xl border-2 border-dashed border-brand-text/70 px-8 py-6 text-center">
            <div className="text-ink font-semibold">Drop to attach</div>
            <div className="text-xs text-ink-muted mt-1">Pictures, up to {MAX_FILES} at a time</div>
          </div>
        </div>,
        dropZoneRef.current,
      )}
    </form>
  )
}

function EmojiSuggestDropdown({ query, items, selectedIdx, onPick, onHover }) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 overflow-hidden z-30" role="listbox" aria-label="Emoji suggestions">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-dim font-semibold border-b border-line-subtle bg-bg-deepest">
        Emoji matching :{query}
      </div>
      <div className="max-h-64 overflow-y-auto scrollbar-thin">
        {items.map((it, idx) => (
          <button
            key={`${it.kind}:${it.name}`}
            type="button"
            role="option"
            aria-selected={idx === selectedIdx}
            onMouseDown={(e) => { e.preventDefault(); onPick(it) }}
            onMouseEnter={() => onHover?.(idx)}
            className={[
              'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
              idx === selectedIdx ? 'bg-bg-hover text-ink' : 'text-ink-muted hover:bg-bg-hover hover:text-ink',
            ].join(' ')}
          >
            <span className="w-6 h-6 grid place-items-center text-xl leading-none shrink-0" aria-hidden="true">
              {it.kind === 'custom' ? <img src={it.dataURL} alt="" className="w-6 h-6 object-contain" /> : it.char}
            </span>
            <span className="text-sm truncate flex-1">:{it.name}:</span>
            {it.kind === 'custom' && <span className="text-[10px] text-ink-dim">custom</span>}
          </button>
        ))}
      </div>
    </div>
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
function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3"/>
      <path d="M5 11a7 7 0 0 0 14 0"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
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
