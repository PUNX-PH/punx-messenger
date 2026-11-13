import { useState } from 'react'
import Modal from './Modal'
import { useAuth } from '../lib/auth'
import { setMyStatus } from '../lib/db'
import { EXPIRY_OPTIONS, STATUS_MAX, STATUS_PRESETS, buildStatus, cleanStatusText, statusOf } from '../lib/status'

/**
 * The dialog for your own status: a line of text, a few ready-made ones, and how long it
 * stays. Opened from the bottom-left panel. What is stored, and how it is cleaned, is
 * src/lib/status.js.
 */
export default function StatusEditor({ open, onClose, current }) {
  const { profile } = useAuth()
  const existing = statusOf({ status: current })
  const [text, setText] = useState(existing?.text || '')
  const [expiry, setExpiry] = useState('today')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const clean = cleanStatusText(text)

  const run = async (status) => {
    setBusy(true); setError('')
    try {
      await setMyStatus(profile?.id, status)
      onClose?.()
    } catch {
      setError("Couldn't save your status. Try again.")
      setBusy(false)
    }
  }
  const save = () => { if (clean && !busy) run(buildStatus(clean, expiry)) }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} maxWidth="max-w-md">
      <form className="p-6" onSubmit={(e) => { e.preventDefault(); save() }}>
        <h2 className="text-lg font-semibold mb-1">Set a status</h2>
        <p className="text-xs text-ink-dim mb-4">Shown next to your name for everyone you work with.</p>

        <label htmlFor="status-text" className="sr-only">Status</label>
        <input
          id="status-text"
          autoFocus
          value={text}
          maxLength={STATUS_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's your status?"
          className="w-full bg-bg-deepest border border-line-subtle rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand"
        />
        <div className="mt-1 text-right text-[11px] text-ink-dim" aria-hidden="true">{Array.from(text).length}/{STATUS_MAX}</div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {STATUS_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setText(p)}
              className="px-2.5 py-1 rounded-full text-xs bg-bg-deepest text-ink-muted hover:text-ink hover:bg-bg-hover border border-line-subtle"
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label htmlFor="status-expiry" className="block text-xs text-ink-dim mb-1">Clear after</label>
          <select
            id="status-expiry"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="w-full text-sm bg-bg-deepest border border-line-subtle rounded-md px-2 py-1.5"
          >
            {EXPIRY_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>

        {error && <div role="alert" className="mt-3 text-sm text-bad">{error}</div>}

        <div className="mt-5 flex items-center gap-2">
          <button type="submit" disabled={!clean || busy} className="px-3 py-1.5 text-sm rounded-md bg-brand text-white hover:bg-brand-hover disabled:opacity-50 transition-colors">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 text-sm rounded-md bg-bg-raised text-ink hover:bg-bg-hover border border-line-subtle disabled:opacity-50">
            Cancel
          </button>
          {existing && (
            <button type="button" onClick={() => run(null)} disabled={busy} className="ml-auto text-xs text-bad hover:underline disabled:opacity-50">
              Clear status
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
