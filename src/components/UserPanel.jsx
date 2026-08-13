import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, isSuperAdmin } from '../lib/auth'
import Avatar from './Avatar'
import { roleLabel } from '../lib/users'
import { computeStatus, useTickNow } from '../lib/presence'
import { useUsers } from '../lib/users'
import { useNotifications } from '../lib/notifications'
import GroupContextMenu from './GroupContextMenu'

// Compact, Discord-style bottom bar: avatar + name/role, one settings icon.
// Notifications and the admin panel used to be separate always-visible
// icons here — moved behind this single menu (same component ServerRail
// already uses for its own context menus) so this row doesn't compete with
// VoiceStatusBar's controls for the sidebar's ~240px width.
export default function UserPanel() {
  const { profile, signOut } = useAuth()
  const { byId } = useUsers()
  const { supported: notifSupported, permission: notifPerm, request: requestNotifPerm } = useNotifications()
  const navigate = useNavigate()
  const now = useTickNow()
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0 })
  const me = byId[profile?.id] || profile
  const status = computeStatus(me, now)

  const openMenu = (e) => setMenu({ open: true, x: e.clientX, y: e.clientY })

  const items = [
    ...(notifSupported ? [{
      label: notifPerm === 'granted' ? 'Notifications: On'
        : notifPerm === 'denied' ? 'Notifications blocked'
        : 'Enable notifications',
      icon: notifPerm === 'denied' ? <BellOffIcon /> : <BellIcon />,
      onClick: notifPerm === 'default' ? requestNotifPerm : undefined,
      disabled: notifPerm !== 'default',
    }] : []),
    ...(isSuperAdmin(profile) ? [{ label: 'Admin panel', icon: <ShieldIcon />, onClick: () => navigate('/admin') }] : []),
    { separator: true },
    { label: 'Sign out', icon: <SignOutIcon />, onClick: signOut, danger: true },
  ]

  return (
    <div className="h-14 bg-bg-deepest border-t border-line-subtle px-2 flex items-center gap-2 shrink-0">
      <Avatar name={profile?.name} src={profile?.photoURL} size={32} status={status} ringColor="border-bg-deepest" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{profile?.name}</div>
        <div className="text-xs text-ink-dim truncate">{roleLabel(profile?.role)}</div>
      </div>

      <button
        onClick={openMenu}
        title="Settings"
        aria-label="Settings"
        className="text-ink-dim hover:text-ink p-1.5 rounded hover:bg-bg-hover transition-colors"
      >
        <GearIcon />
      </button>

      <GroupContextMenu open={menu.open} x={menu.x} y={menu.y} items={items} onClose={() => setMenu(m => ({ ...m, open: false }))} />
    </div>
  )
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}
function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}
function BellOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}
function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
