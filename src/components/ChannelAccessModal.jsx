import { useEffect, useMemo, useState } from 'react'
import { useUsers, roleLabel } from '../lib/users'
import { setChannelAccess } from '../lib/groups'
import { createInvite, DAY_OPTIONS } from '../lib/invites'
import { isGuest, useAuth } from '../lib/auth'
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
 *
 * The list only reaches people who are already in the group, so this also
 * carries a link generator for one who isn't — the same createInvite() the
 * Invites tab uses, pre-scoped to this channel. Only ever rendered behind the
 * channel context menu, which is itself gated on canManage, matching
 * adminOverGroup() on the invite create rule.
 */
export default function ChannelAccessModal({ open, onClose, groupId, channel, group }) {
  const { byId } = useUsers()
  const { profile } = useAuth()
  const [priv, setPriv] = useState(false)
  const [allow, setAllow] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [days, setDays] = useState(7)
  const [link, setLink] = useState(null)
  const [copied, setCopied] = useState(false)

  // Re-seed from the channel every time it opens, so a cancelled edit doesn't
  // leak into the next one.
  useEffect(() => {
    if (!open || !channel) return
    setPriv(!!channel.private)
    setAllow(new Set(channel.allowUids || []))
    setError(null)
    // A link belongs to the channel it was made for; showing the last one
    // again under a different channel's title would be a real footgun.
    setLink(null)
    setCopied(false)
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

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access is permission-gated and fails in some contexts. The
      // link is shown in full below, so there's nothing to recover from.
    }
  }

  const makeLink = async () => {
    setBusy(true); setError(null)
    try {
      const { url } = await createInvite({
        group, channels: [channel], createdBy: profile?.id, days,
      })
      setLink(url)
      await copy(url)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

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

        <div className="mt-4 pt-4 border-t border-line-subtle">
          <div className="text-sm font-medium text-ink mb-1">Invite someone from outside</div>
          <p className="text-xs text-ink-dim mb-3">
            A link granting just this channel. They sign in with any Google account and
            join as a guest &mdash; or keep their role if they already have an account.
            The link is created straight away, whether or not you save the list above.
          </p>

          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              disabled={busy}
              className="text-sm bg-bg-deepest border border-line-subtle rounded-md px-2 py-1.5 disabled:opacity-50"
            >
              {DAY_OPTIONS.map(o => (
                <option key={o.days} value={o.days}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={makeLink}
              disabled={busy || !group}
              className="px-3 py-1.5 text-sm rounded-md bg-bg-raised text-ink hover:bg-bg-hover border border-line-subtle disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Create & copy link'}
            </button>
          </div>

          {link && (
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 text-xs bg-bg-deepest border border-line-subtle rounded-md px-2 py-1.5 text-ink-muted"
              />
              <button
                onClick={() => copy(link)}
                className="px-2 py-1.5 text-xs rounded-md text-ink-muted hover:text-ink hover:bg-bg-raised shrink-0"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}

          <p className="text-[11px] text-ink-dim mt-2">
            Group settings &rarr; Invites lists every link and revokes them.
          </p>
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
