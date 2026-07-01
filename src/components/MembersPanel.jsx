import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import { computeStatus, useTickNow } from '../lib/presence'
import Avatar from './Avatar'

/**
 * Right-hand member list for a group channel.
 * Props:
 *   group:   the group doc (with memberUids, adminUids, ownerUid)
 *   open:    boolean (parent controls show/hide via header toggle)
 */
export default function MembersPanel({ group, open }) {
  const { profile } = useAuth()
  const { users } = useUsers()
  const now = useTickNow()
  const meUid = profile?.id

  const { online, offline, total } = useMemo(() => {
    if (!group) return { online: [], offline: [], total: 0 }
    const memberSet = new Set(group.memberUids || [])
    const adminSet  = new Set(group.adminUids  || [])
    const members = users
      .filter(u => memberSet.has(u.id))
      .map(u => ({
        ...u,
        status: computeStatus(u, now),
        roleTier: group.ownerUid === u.id ? 0 : adminSet.has(u.id) ? 1 : 2,
      }))
      .sort((a, b) => {
        if (a.roleTier !== b.roleTier) return a.roleTier - b.roleTier
        return (a.name || '').localeCompare(b.name || '')
      })
    return {
      online: members.filter(m => m.status !== 'offline'),
      offline: members.filter(m => m.status === 'offline'),
      total: members.length,
    }
  }, [users, group, now])

  if (!open) return null

  return (
    <aside className="hidden lg:flex w-60 bg-bg-dark border-l border-line-subtle flex-col shrink-0">
      <div className="h-12 border-b border-line-subtle flex items-center px-4 shrink-0 shadow-elev1">
        <span className="text-sm font-semibold">Members</span>
        <span className="text-xs text-ink-dim ml-2">— {total}</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin py-2 px-2 space-y-0.5">
        {online.length > 0 && (
          <>
            <SectionLabel>Online — {online.length}</SectionLabel>
            {online.map(m => <MemberRow key={m.id} m={m} meUid={meUid} />)}
          </>
        )}

        {offline.length > 0 && (
          <>
            <SectionLabel className="mt-4">Offline — {offline.length}</SectionLabel>
            {offline.map(m => <MemberRow key={m.id} m={m} meUid={meUid} dim />)}
          </>
        )}

        {total === 0 && (
          <div className="px-2 py-3 text-xs text-ink-dim">No members yet.</div>
        )}
      </div>
    </aside>
  )
}

function SectionLabel({ children, className = '' }) {
  return (
    <div className={`px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wider uppercase text-ink-dim ${className}`}>
      {children}
    </div>
  )
}

function MemberRow({ m, meUid, dim }) {
  const isMe = m.id === meUid
  const inner = (
    <>
      <Avatar name={m.name} src={m.photoURL} size={28} status={m.status} ringColor="border-bg-dark" />
      <span className="text-sm truncate flex-1 text-ink">
        {m.name} {isMe && <span className="text-[10px] text-ink-dim">(you)</span>}
      </span>
      {m.roleTier === 0 && (
        <span className="text-[9px] uppercase tracking-wider text-warn font-semibold shrink-0">Owner</span>
      )}
      {m.roleTier === 1 && (
        <span className="text-[9px] uppercase tracking-wider text-brand font-semibold shrink-0">Admin</span>
      )}
    </>
  )
  const cls = [
    'flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors',
    'hover:bg-bg-hover',
    dim ? 'opacity-55' : '',
  ].join(' ')
  if (isMe) {
    return <div title={m.email} className={cls + ' cursor-default'}>{inner}</div>
  }
  return (
    <Link to={`/dms/${m.id}`} title={`Message ${m.name}`} className={cls}>
      {inner}
    </Link>
  )
}

/**
 * Small button used in the channel header to toggle the members panel.
 * Kept alongside so we can reuse the "people" icon.
 */
export function MembersToggle({ open, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={open ? 'Hide members' : 'Show members'}
      className={[
        'hidden lg:inline-flex items-center justify-center p-1.5 rounded transition-colors',
        open ? 'bg-bg-hover text-ink' : 'text-ink-muted hover:text-ink hover:bg-bg-raised',
      ].join(' ')}
    >
      <PeopleIcon />
    </button>
  )
}

function PeopleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
