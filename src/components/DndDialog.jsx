import { useState } from 'react'
import Modal from './Modal'
import { useAuth } from '../lib/auth'
import { setMyDnd } from '../lib/db'
import { DND_OPTIONS, buildDnd } from '../lib/dnd'

/**
 * "Do not disturb": how long to be left alone. One click on a choice turns it on and closes the
 * box. What is stored, and when it ends, is src/lib/dnd.js.
 */
export default function DndDialog({ open, onClose }) {
  const { profile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const choose = async (id) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await setMyDnd(profile?.id, buildDnd(id))
      onClose?.()
    } catch {
      setError("Couldn't turn it on. Try again.")
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} maxWidth="max-w-sm">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-1">Do not disturb</h2>
        <p className="text-xs text-ink-dim mb-4">
          No sounds and no desktop notifications, for DMs and @mentions. Messages still arrive and show as unread.
        </p>
        <div className="flex flex-col gap-1.5">
          {DND_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={busy}
              onClick={() => choose(o.id)}
              className="text-left px-3 py-2 text-sm rounded-md bg-bg-deepest text-ink hover:bg-bg-hover border border-line-subtle disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
        {error && <div role="alert" className="mt-3 text-sm text-bad">{error}</div>}
        <div className="mt-4">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 text-sm rounded-md bg-bg-raised text-ink hover:bg-bg-hover border border-line-subtle disabled:opacity-50">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
