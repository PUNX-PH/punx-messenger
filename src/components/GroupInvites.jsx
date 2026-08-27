import { useEffect, useMemo, useState } from 'react'
import { useAuth, channelViewer } from '../lib/auth'
import { listenChannels } from '../lib/groups'
import {
  createInvite, inviteIsLive, inviteUrl, listenGroupInvites, revokeInvite,
} from '../lib/invites'

const DAY_OPTIONS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

/**
 * Create and revoke channel invite links for one group.
 *
 * A link grants a fixed set of channels and is reusable until it expires or is
 * revoked. Anyone who opens it and signs in with any Google account joins as a
 * guest, seeing those channels and nothing else; someone who already has an
 * account keeps whatever role they had. See src/lib/invites.js.
 */
export default function GroupInvites({ group, canEdit, meUid }) {
  const { profile } = useAuth()
  const [channels, setChannels] = useState([])
  const [invites, setInvites] = useState([])
  const [picked, setPicked] = useState(() => new Set())
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)

  // An invite can only ever grant channels the admin creating it can see,
  // which is what the viewer decides — without one this lists public channels
  // only, and a private channel could never be shared with a guest.
  const viewer = channelViewer(profile, group)

  useEffect(() => {
    if (!group?.id) return
    return listenChannels(group.id, setChannels, undefined, viewer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, viewer.uid, viewer.guest, viewer.seesPrivate])

  useEffect(() => {
    if (!group?.id || !canEdit) return
    return listenGroupInvites(group.id, setInvites, (e) => setError(e.message))
  }, [group?.id, canEdit])

  const sorted = useMemo(
    () => [...invites].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    [invites],
  )

  if (!canEdit) {
    return (
      <p className="text-sm text-ink-muted py-2">
        Only this group's admins can create invite links.
      </p>
    )
  }

  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const create = async () => {
    setBusy(true); setError(null)
    try {
      const chosen = channels.filter(c => picked.has(c.id))
      const { url } = await createInvite({
        group, channels: chosen, createdBy: meUid, days,
      })
      await copy(url)
      setPicked(new Set())
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      // Clipboard is permission-gated and fails in some contexts; the link is
      // shown in full below either way, so this is not worth an error banner.
    }
  }

  return (
    <div className="pb-4">
      <div className="text-sm font-medium text-ink mb-1">New invite link</div>
      <p className="text-xs text-ink-dim mb-3">
        Pick the channels it should grant. Anyone with the link can join those channels
        &mdash; as a guest if they're new, keeping their role if they already have an account.
      </p>

      <div className="max-h-40 overflow-y-auto scrollbar-thin border border-line-subtle rounded-md p-1 mb-3">
        {channels.length === 0 ? (
          <div className="px-2 py-2 text-xs text-ink-dim">No channels in this group yet.</div>
        ) : channels.map(c => (
          <label
            key={c.id}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-sm hover:bg-bg-hover cursor-pointer"
          >
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              onChange={() => toggle(c.id)}
              className="accent-brand"
            />
            <span className="text-ink-dim text-xs">{c.type === 'voice' ? '🔊' : '#'}</span>
            <span className="text-sm truncate flex-1">{c.name}</span>
            {c.private && <span className="text-[10px] uppercase tracking-wider text-ink-dim">private</span>}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-ink-dim">Expires in</span>
        {DAY_OPTIONS.map(o => (
          <button
            key={o.days}
            type="button"
            onClick={() => setDays(o.days)}
            className={[
              'text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors',
              days === o.days ? 'bg-brand text-white' : 'bg-bg-deepest text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={create}
          disabled={busy || picked.size === 0}
          className="px-3 py-1.5 text-sm rounded-md bg-brand text-white font-medium hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Creating…' : 'Create & copy link'}
        </button>
      </div>

      {error && (
        <div className="mb-3 text-sm text-bad bg-bad/10 border border-bad/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="text-sm font-medium text-ink mb-2">
        Existing links <span className="text-ink-dim">({sorted.length})</span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-ink-dim">None yet.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map(inv => {
            const live = inviteIsLive(inv)
            const url = inviteUrl(inv.token)
            return (
              <div
                key={inv.token}
                className={[
                  'border border-line-subtle rounded-md px-3 py-2',
                  live ? '' : 'opacity-60',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink truncate flex-1">
                    {(inv.channelNames || []).map(n => `#${n}`).join(', ') || 'no channels'}
                  </span>
                  {!live && (
                    <span className="text-[10px] uppercase tracking-wider text-ink-dim shrink-0">
                      {inv.revoked ? 'revoked' : 'expired'}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-[10px] text-ink-dim truncate flex-1">{url}</code>
                  {live && (
                    <>
                      <button
                        onClick={() => copy(url)}
                        className="text-xs text-brand hover:underline shrink-0"
                      >
                        {copied === url ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={() => revokeInvite(inv.token).catch(e => setError(e.message))}
                        className="text-xs text-ink-dim hover:text-bad shrink-0"
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-ink-dim">
                  {expiryLabel(inv)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function expiryLabel(inv) {
  const ms = inv.expiresAt?.toMillis?.() ?? new Date(inv.expiresAt).getTime()
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return ms > Date.now() ? `Expires ${when}` : `Expired ${when}`
}
