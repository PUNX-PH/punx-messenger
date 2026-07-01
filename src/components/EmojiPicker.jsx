import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, isAdmin } from '../lib/auth'
import { createEmoji, deleteEmoji, useEmojis } from '../lib/emojis'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '😮', '😢', '🙏', '👀', '✅']

/**
 * Floating emoji picker popover.
 * Props:
 *   anchorRef: ref of the trigger button
 *   open:      boolean
 *   onClose:   () => void
 *   onPick:    (token: string) => void   // ":name:" for custom, "👍" for unicode
 *   position:  'top-right' (default, above) | 'bottom-right' (below)
 */
export default function EmojiPicker({ anchorRef, open, onClose, onPick, position = 'top-right' }) {
  const popRef = useRef(null)
  const { profile } = useAuth()
  const { emojis } = useEmojis()
  const [filter, setFilter] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (popRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, anchorRef, onClose])

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return emojis
    return emojis.filter(e => e.name.includes(f))
  }, [emojis, filter])

  if (!open) return null

  const posClass = position === 'bottom-right'
    ? 'top-full right-0 mt-2'
    : 'bottom-full right-0 mb-2'

  return (
    <div
      ref={popRef}
      className={`absolute ${posClass} w-[340px] bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 overflow-hidden z-40 flex flex-col`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-line-subtle bg-bg-deepest">
        <input
          autoFocus
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search emojis"
          className="w-full h-7 bg-bg-raised text-sm rounded-sm px-2 outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {!filter && (
        <div className="px-2 pt-2 pb-1 border-b border-line-subtle">
          <div className="text-[10px] uppercase tracking-wider text-ink-dim font-semibold mb-1 px-1">
            Quick
          </div>
          <div className="grid grid-cols-10 gap-0.5">
            {QUICK_EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => { onPick(e); onClose?.() }}
                className="w-7 h-7 rounded hover:bg-bg-hover grid place-items-center transition-colors text-base"
                title={e}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin max-h-72 p-2">
        {visible.length === 0 ? (
          <div className="p-4 text-center text-xs text-ink-muted">
            {emojis.length === 0
              ? 'No custom emojis yet.'
              : 'No match.'}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {visible.map(e => (
              <button
                key={e.id}
                onClick={() => { onPick(`:${e.name}:`); onClose?.() }}
                title={`:${e.name}:`}
                className="w-10 h-10 rounded hover:bg-bg-hover grid place-items-center transition-colors"
              >
                <img src={e.dataURL} alt={e.name} className="w-7 h-7" />
              </button>
            ))}
          </div>
        )}
      </div>

      {isAdmin(profile) && (
        <UploadStrip
          uploading={uploading}
          setUploading={setUploading}
          createdBy={profile?.id}
        />
      )}

      {isAdmin(profile) && emojis.length > 0 && (
        <details className="border-t border-line-subtle">
          <summary className="px-3 py-2 text-xs text-ink-muted cursor-pointer hover:text-ink select-none">
            Manage emojis ({emojis.length})
          </summary>
          <div className="max-h-40 overflow-y-auto scrollbar-thin p-2 space-y-1 border-t border-line-subtle bg-bg-deepest">
            {emojis.map(e => (
              <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-hover">
                <img src={e.dataURL} alt="" className="w-6 h-6" />
                <span className="text-xs text-ink flex-1 truncate">:{e.name}:</span>
                <button
                  onClick={() => {
                    if (confirm(`Delete :${e.name}: ?`)) deleteEmoji(e.id)
                  }}
                  className="text-xs text-ink-dim hover:text-bad"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function UploadStrip({ uploading, setUploading, createdBy }) {
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState(null)

  const reset = () => { setFile(null); setName(''); setError(null) }

  const pickName = (filename) => {
    const base = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32)
    return base.replace(/^_+|_+$/g, '')
  }

  const onPick = (f) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { setError('Pick an image.'); return }
    setError(null)
    setFile(f)
    if (!name) setName(pickName(f.name))
  }

  const submit = async () => {
    if (!file || !name.trim() || uploading) return
    setUploading(true); setError(null)
    try {
      await createEmoji({ name, file, createdBy })
      reset()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    // NOTE: NOT a <form> — this component is rendered inside the Composer's
    // <form>, and nested forms are invalid HTML.
    <div className="border-t border-line-subtle p-2 bg-bg-deepest">
      {!file ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full text-xs text-ink-muted hover:text-ink py-2 border border-dashed border-line-strong rounded transition-colors"
        >
          + Upload custom emoji
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <img
            src={URL.createObjectURL(file)}
            alt=""
            onLoad={(e) => URL.revokeObjectURL(e.currentTarget.src)}
            className="w-8 h-8 rounded bg-bg-raised border border-line-subtle"
          />
          <span className="text-xs text-ink-dim">:</span>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit() }
              if (e.key === 'Escape') { e.preventDefault(); reset() }
            }}
            maxLength={32}
            placeholder="name"
            className="flex-1 min-w-0 bg-bg-raised border border-line-subtle text-sm rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-brand"
          />
          <span className="text-xs text-ink-dim">:</span>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || uploading}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-medium px-2 py-1 rounded"
          >
            {uploading ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="text-ink-dim hover:text-ink text-xs"
            title="Cancel"
          >
            ✕
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      {error && <div className="mt-2 text-xs text-bad">{error}</div>}
    </div>
  )
}
