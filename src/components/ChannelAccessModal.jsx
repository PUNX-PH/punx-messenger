import { useEffect, useMemo, useState } from 'react'
import { useUsers, roleLabel } from '../lib/users'
import { setChannelAccess } from '../lib/groups'
import { isGuest } from '../lib/auth'
import Modal from './Modal'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'

/**
 * Who can see one channel.
 *
 * Two knobs, and the difference matters when explaining it to whoever is
 * clicking:
 *
 *   Private   — hides the channel from group members who aren't on the list.
 *               Group and workspace admins still see it, same as Discord.
 *   The list  — `allowUids`. For a GUEST it is the only thing that counts:
 *               guests see nothing except channels naming them, so inviting a
 *               guest to a public channel works without making it private.
 *
 * That's why guests are shown in their own section with the list framed as an
 * invitation, while everyone else is framed as an exception to "private".
 */
export default function ChannelAccessModal({ open, onClose, groupId, channel, group }) {
  const { byId } = useUsers()
  const [priv, setPriv] = useState(false)
  const [allow, setAllow] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Re-seed from the channel every time it opens, so a cancelled edit doesn't
  // leak into the next one.
  useEffect(() => {
    if (!open || !channel) return
    setPriv(!!channel.private)
    setAllow(new Set(channel.allowUids || []))
    setError(null)
  }, [open, channel?.id, channel?.private, channel?.allowUids])

  const { guests, members } = useMemo(() => {
    const uids = group?.memberUids || []
    const people = uids.map(uid => byId[uid]).filter(Boolean)
    people.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return {
      guests: people.filter(isGuest),
      members: people.filter(p => !isGuest(p)),
    }
  }, [group?.memberUids, byId])

  if (!channel) return null

  const toggle = (uid) => setAllow(prev => {
    const next = new Set(prev)
    if (next.has(uid)) next.delete(uid)
    else next.add(uid)
    return next
  })

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await setChannelAccess(groupId, channel.id, { isPrivate: priv, allowUids: [...allow] })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const Row = ({ p, hint }) => (
    <label
      key={p.id}
      className="flex items-center gap-2.5 px-2 py-1.5 rounded-sm hover:bg-bg-hover cursor-pointer"
    >
      <input
        type="checkbox"
        checked={allow.has(p.id)}
        onChange={() => toggle(p.id)}
        className="accent-brand"
      />
      <Avatar name={p.name} src={p.photoURL} size={26} />
      <span className="text-sm truncate flex-1">{p.name}</span>
      {hint && <span className="text-[10px] text-ink-dim shrink-0">{hint}</span>}
      <RoleBadge role={p.role} size="xs" />
    </label>
  )

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} maxWidth="max-w-md">
      <div className="p-5">
        <div className="text-base font-semibold mb-1">
          Access to {channel.type === 'voice' ? '' : '#'}{channel.name}
        </div>
        <p className="text-xs text-ink-dim mb-4">
          Guests only ever see channels they're listed in. Everyone else sees this channel
          unless it's private.
        </p>

        <label className="flex items-start gap-2.5 p-3 mb-4 rounded-md bg-bg-deepest border border-line-subtle cursor-pointer">
          <input
            type="checkbox"
            checked={priv}
            onChange={(e) => setPriv(e.target.checked)}
            className="mt-0.5 accent-brand"
          />
          <span className="text-sm">
            <span className="font-medium">Private channel</span>
            <span className="block text-xs text-ink-dim mt-0.5">
              Hidden from group members who aren't listed below. Group and workspace admins
              can still see it.
            </span>
          </span>
        </label>

        {error && (
          <div className="mb-3 text-sm text-bad bg-bad/10 border border-bad/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto scrollbar-thin -mx-1 px-1">
          {guests.length > 0 && (
            <>
              <SectionLabel>
                Guests — invite explicitly, {guests.length} in this group
              </SectionLabel>
              {guests.map(p => <Row key={p.id} p={p} hint="needs an invite" />)}
            </>
          )}

          <SectionLabel className={guests.length ? 'mt-3' : ''}>
            {priv ? 'Members who can see it' : 'Members'}
          </SectionLabel>
          {members.length === 0
            ? <div className="px-2 py-2 text-xs text-ink-dim">No members yet.</div>
            : members.map(p => (
                <Row key={p.id} p={p} hint={!priv ? 'already has access' : undefined} />
              ))}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md text-ink-muted hover:text-ink hover:bg-bg-raised disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-brand text-white font-medium hover:opacity-90 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save access'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SectionLabel({ children, className = '' }) {
  return (
    <div className={`px-2 pb-1 text-[11px] font-semibold tracking-wider uppercase text-ink-dim ${className}`}>
      {children}
    </div>
  )
}
