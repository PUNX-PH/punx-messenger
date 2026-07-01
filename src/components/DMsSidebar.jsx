import { useEffect, useMemo, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import { isUnread, listenMyDmConvos, pathToReadKey } from '../lib/db'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import UserPanel from './UserPanel'

export default function DMsSidebar() {
  const { profile } = useAuth()
  const { byId: usersById, users } = useUsers()
  const { otherUid: activeOtherUid } = useParams()
  const [filter, setFilter] = useState('')
  const [convosByOther, setConvosByOther] = useState({})

  useEffect(() => {
    if (!profile?.id) return
    return listenMyDmConvos(profile.id, setConvosByOther)
  }, [profile?.id])

  const me = usersById[profile?.id]
  const lastRead = me?.lastRead || {}

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return users
      .filter(u => u.id !== profile?.id)
      .filter(u => !f || u.name?.toLowerCase().includes(f) || u.email?.toLowerCase().includes(f))
  }, [users, filter, profile])

  return (
    <aside className="w-60 bg-bg-dark flex flex-col border-r border-line-subtle">
      <div className="h-12 px-2.5 flex items-center border-b border-line-subtle shadow-elev1">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Find a conversation"
          className="w-full h-7 bg-bg-deepest text-sm rounded-sm px-2 placeholder:text-ink-dim outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin py-2 px-2 space-y-0.5">
        <PinnedItem to="/me/notes" icon={<NoteIcon />} label="My Notes" />

        <div className="px-2 pt-4 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-ink-dim">
            Direct messages
          </span>
          <span className="text-[11px] text-ink-dim">{visible.length}</span>
        </div>

        {visible.length === 0 && (
          <div className="px-2 py-3 text-xs text-ink-dim">
            {users.length <= 1 ? 'No other teammates yet.' : 'No match.'}
          </div>
        )}

        {visible.map(u => {
          const convo = convosByOther[u.id]
          const isActive = u.id === activeOtherUid
          const unread = !isActive && convo
            && isUnread(convo.lastMessageAt, lastRead[pathToReadKey(`dms/${convo.id}`)])

          return (
            <NavLink
              key={u.id}
              to={`/dms/${u.id}`}
              className={({ isActive }) => [
                'flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm transition-colors duration-150',
                isActive
                  ? 'bg-bg-hover text-ink'
                  : unread
                    ? 'text-ink font-semibold hover:bg-bg-raised'
                    : 'text-ink-muted hover:bg-bg-raised hover:text-ink',
              ].join(' ')}
            >
              <Avatar name={u.name} src={u.photoURL} size={28} />
              <span className="truncate flex-1">{u.name}</span>
              {unread && <span className="w-2 h-2 rounded-full bg-bad shrink-0" />}
              <RoleBadge role={u.role} size="xs" />
            </NavLink>
          )
        })}
      </div>

      <UserPanel />
    </aside>
  )
}

function PinnedItem({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => [
        'flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm transition-colors duration-150',
        isActive
          ? 'bg-bg-hover text-ink'
          : 'text-ink-muted hover:bg-bg-raised hover:text-ink',
      ].join(' ')}
    >
      <span className="text-ink-dim">{icon}</span>
      <span className="truncate font-medium">{label}</span>
    </NavLink>
  )
}

function NoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  )
}
