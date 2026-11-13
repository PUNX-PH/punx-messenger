import { useEffect, useMemo, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { usePresence, useUsers } from '../lib/users'
import { isUnread, listenMyDmConvos, markManyRead, pathToReadKey, toggleMuteChat } from '../lib/db'
import { mutedChatsOf, muteLabel } from '../lib/muted'
import { BellOffIcon, BellOnIcon } from './BellIcons'
import { statusOf } from '../lib/status'
import { unreadKeys } from '../lib/unread'
import GroupContextMenu from './GroupContextMenu'
import { computeStatus, useTickNow } from '../lib/presence'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import UserPanel from './UserPanel'
import VoiceStatusBar from './voice/VoiceStatusBar'

export default function DMsSidebar() {
  const { profile } = useAuth()
  // activeUsers, not users: a removed teammate and a switched-off bot both
  // drop out of this list. Existing conversations with them stay openable by
  // URL, and their messages keep their author.
  const { byId: usersById, activeUsers: users } = useUsers()
  const { otherUid: activeOtherUid } = useParams()
  const [filter, setFilter] = useState('')
  const [convosByOther, setConvosByOther] = useState({})
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0, convo: null })
  const now = useTickNow()
  const presence = usePresence()

  useEffect(() => {
    if (!profile?.id) return
    return listenMyDmConvos(profile.id, setConvosByOther)
  }, [profile?.id])

  const me = usersById[profile?.id]
  const lastRead = me?.lastRead || {}
  const mutedChats = useMemo(() => mutedChatsOf(me), [me?.mutedChats])

  // Which direct messages have something new, so "Mark all read" is only offered when it would do something.
  const unreadDmKeys = useMemo(
    // Muted ones are quiet: they show no dot, so they are not what "Mark all read" is offered for.
    () => unreadKeys({ dmConvos: Object.values(convosByOther), lastRead }).dms.filter(k => !mutedChats.has(k)),
    [convosByOther, lastRead, mutedChats],
  )

  const menuKey = menu.convo ? pathToReadKey(`dms/${menu.convo.id}`) : null
  const menuUnread = !!menu.convo && isUnread(menu.convo.lastMessageAt, lastRead[menuKey])
  const menuMuted = mutedChats.has(menuKey)
  const menuItems = menu.convo ? [{
    label: 'Mark as read',
    icon: <CheckIcon />,
    onClick: () => markManyRead(profile.id, [menuKey]).catch((e) => console.warn('[unread] could not mark as read:', e)),
    disabled: !menuUnread,
    trailing: menuUnread ? undefined : 'already read',
  }, {
    label: muteLabel(menuMuted, 'conversation'),
    icon: menuMuted ? <BellOnIcon /> : <BellOffIcon />,
    onClick: () => toggleMuteChat(profile.id, menuKey, !menuMuted).catch((e) => console.warn('[mute] could not change it:', e)),
  }] : []

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
          <span className="flex items-center gap-2">
            {unreadDmKeys.length > 0 && (
              <button
                type="button"
                onClick={() => markManyRead(profile.id, unreadDmKeys).catch((e) => console.warn('[unread] could not mark as read:', e))}
                aria-label="Mark all direct messages as read"
                className="text-[11px] text-brand-text hover:underline"
              >
                Mark all read
              </button>
            )}
            <span className="text-[11px] text-ink-dim">{visible.length}</span>
          </span>
        </div>

        {visible.length === 0 && (
          <div className="px-2 py-3 text-xs text-ink-dim">
            {users.length <= 1 ? 'No other teammates yet.' : 'No match.'}
          </div>
        )}

        {visible.map(u => {
          const convo = convosByOther[u.id]
          const isActive = u.id === activeOtherUid
          const st = statusOf(u, now)
          const muted = !!convo && mutedChats.has(pathToReadKey(`dms/${convo.id}`))
          // A muted conversation is quiet: no dot, no bold, dimmed. It still opens as usual.
          const unread = !muted && !isActive && convo
            && isUnread(convo.lastMessageAt, lastRead[pathToReadKey(`dms/${convo.id}`)])

          return (
            <NavLink
              key={u.id}
              to={`/dms/${u.id}`}
              title={muted ? `${u.name} (muted)` : undefined}
              onContextMenu={convo ? (e) => { e.preventDefault(); setMenu({ open: true, x: e.clientX, y: e.clientY, convo }) } : undefined}
              className={({ isActive }) => [
                'flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm transition-colors duration-150',
                isActive
                  ? 'bg-bg-hover text-ink'
                  : unread
                    ? 'text-ink font-semibold hover:bg-bg-raised'
                    : 'text-ink-muted hover:bg-bg-raised hover:text-ink',
                muted && !isActive ? 'opacity-60 hover:opacity-100' : '',
              ].join(' ')}
            >
              <Avatar name={u.name} src={u.photoURL} size={28} status={computeStatus(presence[u.id], now)} />
              <span className="flex-1 min-w-0">
                <span className="block truncate">{u.name}</span>
                {st && <span className="block text-[11px] font-normal text-ink-dim truncate" title={st.text}>{st.text}</span>}
              </span>
              {unread && <span className="w-2 h-2 rounded-full bg-bad shrink-0" />}
              <RoleBadge role={u.role} size="xs" />
            </NavLink>
          )
        })}
      </div>

      <VoiceStatusBar />
      <UserPanel />
      <GroupContextMenu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        items={menuItems}
        onClose={() => setMenu(m => ({ ...m, open: false }))}
      />
    </aside>
  )
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
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
