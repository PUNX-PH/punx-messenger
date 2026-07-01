import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import {
  leaveGroup, listenChannels, listenMyGroups,
  markGroupAsRead, toggleMuteGroup,
} from '../lib/groups'
import { isUnread, pathToReadKey } from '../lib/db'
import CreateGroupModal from './CreateGroupModal'
import GroupContextMenu from './GroupContextMenu'

export default function ServerRail() {
  const { profile } = useAuth()
  const { byId: usersById } = useUsers()
  const loc = useLocation()
  const navigate = useNavigate()
  const [groups, setGroups] = useState([])
  const [channelsByGroup, setChannelsByGroup] = useState({})
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0, group: null })

  const me = usersById[profile?.id]
  const lastRead = me?.lastRead || {}
  const mutedGroups = useMemo(() => new Set(me?.mutedGroups || []), [me?.mutedGroups])

  useEffect(() => {
    if (!profile?.id) return
    return listenMyGroups(profile.id, setGroups)
  }, [profile?.id])

  // Listen to channels of every group I'm in (for rail unread state)
  useEffect(() => {
    if (groups.length === 0) { setChannelsByGroup({}); return }
    const unsubs = groups.map(g =>
      listenChannels(g.id, (chs) => {
        setChannelsByGroup(prev => ({ ...prev, [g.id]: chs }))
      })
    )
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map(g => g.id).join('|')])

  const onDMs = loc.pathname === '/' || loc.pathname.startsWith('/dms') || loc.pathname.startsWith('/me')

  const groupHasUnread = (g) => {
    if (mutedGroups.has(g.id)) return false
    const channels = channelsByGroup[g.id] || []
    return channels.some(c =>
      isUnread(c.lastMessageAt, lastRead[pathToReadKey(`groups/${g.id}/channels/${c.id}`)])
    )
  }

  const openMenu = (e, group) => {
    e.preventDefault?.()
    setMenu({ open: true, x: e.clientX, y: e.clientY, group })
  }
  const closeMenu = () => setMenu(m => ({ ...m, open: false }))

  const onLeave = async (group) => {
    if (!confirm(`Leave "${group.name}"? You'll lose access to its channels until you're invited back.`)) return
    try {
      await leaveGroup(group.id, profile.id, group.ownerUid)
      if (loc.pathname.startsWith(`/g/${group.id}`)) navigate('/dms', { replace: true })
    } catch (e) {
      alert(e.message)
    }
  }

  const menuItems = menu.group ? buildMenuItems({
    group: menu.group,
    meUid: profile.id,
    isMuted: mutedGroups.has(menu.group.id),
    onMarkRead: () => markGroupAsRead(profile.id, menu.group.id),
    onToggleMute: () => toggleMuteGroup(profile.id, menu.group.id, !mutedGroups.has(menu.group.id)),
    onOpenSettings: () => navigate(`/g/${menu.group.id}?settings=1`),
    onLeave: () => onLeave(menu.group),
  }) : []

  return (
    <>
      <aside className="w-[72px] bg-bg-deepest flex flex-col items-center pt-safe pb-3 gap-2 border-r border-line-subtle overflow-y-auto scrollbar-thin">
        <RailLink to="/dms" active={onDMs} label="Direct messages">
          <HomeIcon />
        </RailLink>

        <div className="w-8 h-px bg-line-subtle my-1" />

        {groups.map(g => (
          <GroupRailLink
            key={g.id}
            group={g}
            isMuted={mutedGroups.has(g.id)}
            hasUnread={groupHasUnread(g)}
            onContextMenu={(e) => openMenu(e, g)}
          />
        ))}

        <button
          onClick={() => setCreating(true)}
          title="Create group"
          className="w-12 h-12 grid place-items-center font-semibold rounded-2xl hover:rounded-xl bg-bg-raised text-ok hover:bg-ok hover:text-white transition-all duration-150"
        >
          <PlusIcon />
        </button>
      </aside>

      <CreateGroupModal open={creating} onClose={() => setCreating(false)} />

      <GroupContextMenu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        items={menuItems}
        onClose={closeMenu}
      />
    </>
  )
}

function buildMenuItems({ group, meUid, isMuted, onMarkRead, onToggleMute, onOpenSettings, onLeave }) {
  const isOwner = group.ownerUid === meUid
  return [
    { label: 'Mark as read',          icon: <CheckIcon />,  onClick: onMarkRead },
    { label: isMuted ? 'Unmute group' : 'Mute group',
      icon: isMuted ? <BellOnIcon /> : <BellOffIcon />,
      onClick: onToggleMute },
    { separator: true },
    { label: 'Group settings',        icon: <GearIcon />,   onClick: onOpenSettings },
    { separator: true },
    {
      label: isOwner ? 'Leave group (owner)' : 'Leave group',
      icon: <ExitIcon />,
      onClick: onLeave,
      danger: true,
      disabled: isOwner,
      trailing: isOwner ? 'transfer first' : undefined,
    },
  ]
}

function GroupRailLink({ group, isMuted, hasUnread, onContextMenu }) {
  const loc = useLocation()
  const isActive = loc.pathname.startsWith(`/g/${group.id}`)
  const press = useLongPress((pos) => {
    onContextMenu({
      preventDefault: () => {},
      clientX: pos.x,
      clientY: pos.y,
    })
  }, 450)
  return (
    <div
      // Right-click is still wired as a bonus; primary trigger is hold-click.
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e) }}
      onMouseDown={press.onMouseDown}
      onMouseUp={press.onMouseUp}
      onMouseLeave={press.onMouseLeave}
      onTouchStart={press.onTouchStart}
      onTouchEnd={press.onTouchEnd}
      onTouchMove={press.onTouchMove}
      onClick={press.onClick}
      className="relative"
    >
      <NavLink
        to={`/g/${group.id}`}
        title={group.name + (isMuted ? ' (muted) — hold to open menu' : ' — hold to open menu')}
        className={[
          'group relative w-12 h-12 grid place-items-center font-semibold overflow-hidden transition-all duration-150',
          'rounded-2xl hover:rounded-xl select-none',
          isActive
            ? 'rounded-xl bg-brand text-white'
            : 'bg-bg-raised text-ink hover:bg-brand hover:text-white',
          isMuted && !isActive ? 'opacity-50 hover:opacity-100' : '',
        ].join(' ')}
      >
        {group.imageURL
          ? <img src={group.imageURL} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
          : <span>{group.name?.[0]?.toUpperCase() || '?'}</span>}
        <Pill active={isActive} hasUnread={hasUnread && !isActive} />
        {hasUnread && !isActive && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-bad border-2 border-bg-deepest" />
        )}
      </NavLink>
    </div>
  )
}

// Mouse + touch long-press. Holds the left button (or finger) for `ms` opens
// the menu. The subsequent click is swallowed so the link doesn't navigate.
function useLongPress(callback, ms = 450) {
  const timerRef = useRef(null)
  const firedRef = useRef(false)
  const posRef = useRef({ x: 0, y: 0 })

  const start = (e) => {
    // ignore right-click here; contextmenu handler covers that
    if (e.button != null && e.button !== 0) return
    firedRef.current = false
    const t = e.touches?.[0]
    posRef.current = t
      ? { x: t.clientX, y: t.clientY }
      : { x: e.clientX, y: e.clientY }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      timerRef.current = null
      callback(posRef.current)
    }, ms)
  }
  const cancel = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }
  const onClick = (e) => {
    if (firedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      firedRef.current = false
    }
  }

  return {
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onClick,
  }
}

function RailLink({ to, active, children, label }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={() => [
        'group relative w-12 h-12 grid place-items-center font-semibold transition-all duration-150',
        'rounded-2xl hover:rounded-xl',
        active
          ? 'rounded-xl bg-brand text-white'
          : 'bg-bg-raised text-ink hover:bg-brand hover:text-white',
      ].join(' ')}
    >
      {children}
      <Pill active={active} />
    </NavLink>
  )
}

function Pill({ active, hasUnread }) {
  return (
    <span
      className={[
        'absolute -left-3 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r transition-all duration-150',
        active
          ? 'h-8 opacity-100'
          : hasUnread
            ? 'h-3 opacity-100'
            : 'h-2 opacity-0 group-hover:opacity-100 group-hover:h-5',
      ].join(' ')}
    />
  )
}

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3z"/>
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
}
function BellOnIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
}
function BellOffIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
}
function GearIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}
function ExitIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
}
