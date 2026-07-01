import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { createGroup } from '../lib/groups'
import Modal from './Modal'

export default function CreateGroupModal({ open, onClose }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const close = () => {
    if (busy) return
    setFile(null); setPreview(null); setName(''); setError(null)
    onClose?.()
  }

  const pickFile = (f) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { setError('Pick an image file.'); return }
    if (f.size > 5 * 1024 * 1024) { setError('Max 5 MB.'); return }
    setError(null)
    setFile(f)
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result)
    reader.readAsDataURL(f)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const { groupId, generalChannelId } = await createGroup({
        name, avatarFile: file, owner: profile,
      })
      close()
      navigate(`/g/${groupId}/c/${generalChannelId}`)
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Failed to create group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close}>
      <form onSubmit={submit} className="p-6">
        <h2 className="text-xl font-bold tracking-tight text-center">Customize Your Group</h2>
        <p className="text-sm text-ink-muted text-center mt-2 mb-6">
          Give your new group a personality with a name and an icon. You can always change it later.
        </p>

        {/* Avatar upload */}
        <div className="grid place-items-center mb-6">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault() }}
            onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]) }}
            className={[
              'relative w-20 h-20 rounded-full grid place-items-center overflow-hidden transition-colors',
              preview
                ? 'border border-line-subtle'
                : 'border-2 border-dashed border-line-strong text-ink-dim hover:text-ink hover:border-ink-muted',
            ].join(' ')}
          >
            {preview ? (
              <img src={preview} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="text-center text-[10px] font-semibold tracking-wider uppercase leading-tight">
                <CameraIcon />
                <div className="mt-1">Upload</div>
              </div>
            )}
            <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-brand grid place-items-center text-white shadow-elev1">
              <PlusIcon />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        {/* Name */}
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
          Group Name <span className="text-bad">*</span>
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${profile?.name?.split(' ')[0] || "Rey"}'s group`}
          autoFocus
          maxLength={50}
          className="w-full bg-bg-deepest border border-line-subtle rounded-md px-3 py-2 text-sm outline-none focus:border-brand"
        />

        {error && (
          <div className="mt-3 text-sm text-bad bg-bad/10 border border-bad/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <p className="text-xs text-ink-dim mt-6 text-center">
          By creating a group, you agree to follow Punx's internal acceptable-use policy.
        </p>

        <div className="flex items-center justify-between mt-6 -mx-6 -mb-6 px-6 py-4 bg-bg-deepest rounded-b-lg">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="text-ink-muted hover:underline text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
