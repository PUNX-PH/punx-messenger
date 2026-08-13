import { forwardRef, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, isSuperAdmin } from '../lib/auth'
import Avatar from './Avatar'
import { roleLabel } from '../lib/users'
import { computeStatus, useTickNow } from '../lib/presence'
import { useUsers } from '../lib/users'
import { useNotifications } from '../lib/notifications'
import { useVoiceChannel } from '../lib/useVoiceChannel'
import GroupContextMenu from './GroupContextMenu'
import VoiceSettingsPopover from './voice/VoiceSettingsPopover'

// Compact, Discord-style bottom bar: avatar + name/role, then whatever
// icons are actually relevant right now. Mic/deafen only show up while
// connected to a voice channel (see VoiceStatusBar's comment for why they
// live here instead of there — this is the "your own avatar" row, same
// spot Discord puts them). Notifications/admin-panel/sign-out live behind
// the gear so this row never has to cram more than 3 icons at once.
export default function UserPanel() {
  const { profile, signOut } = useAuth()
  const { byId } = useUsers()
  const { supported: notifSupported, permission: notifPerm, request: requestNotifPerm } = useNotifications()
  const { activeChannel, muted, deafened, toggleMute, toggleDeafen } = useVoiceChannel()
  const navigate = useNavigate()
  const now = useTickNow()
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0 })
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false)
  const gearBtnRef = useRef(null)
  const me = byId[profile?.id] || profile
  const status = computeStatus(me, now)

  const openMenu = (e) => setMenu({ open: true, x: e.clientX, y: e.clientY })

  const items = [
    ...(activeChannel ? [
      { label: 'Voice Settings', icon: <GearIcon />, onClick: () => setVoiceSettingsOpen(true) },
      { separator: true },
    ] : []),
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
    <div className="h-14 bg-bg-deepest border-t border-line-subtle px-2 flex items-center gap-1.5 shrink-0">
      <Avatar name={profile?.name} src={profile?.photoURL} size={32} status={status} ringColor="border-bg-deepest" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{profile?.name}</div>
        <div className="text-xs text-ink-dim truncate">
          {activeChannel ? 'In voice' : roleLabel(profile?.role)}
        </div>
      </div>

      {activeChannel && (
        <>
          <FlatIconButton onClick={toggleMute} active={muted} label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <MicOffIcon /> : <MicIcon />}
          </FlatIconButton>
          <FlatIconButton onClick={toggleDeafen} active={deafened} label={deafened ? 'Undeafen' : 'Deafen'}>
            {deafened ? <DeafenedIcon /> : <HeadphonesIcon />}
          </FlatIconButton>
        </>
      )}

      <FlatIconButton ref={gearBtnRef} onClick={openMenu} label="Settings">
        <GearIcon />
      </FlatIconButton>

      <GroupContextMenu open={menu.open} x={menu.x} y={menu.y} items={items} onClose={() => setMenu(m => ({ ...m, open: false }))} />
      {voiceSettingsOpen && (
        <VoiceSettingsPopover anchorRef={gearBtnRef} onClose={() => setVoiceSettingsOpen(false)} />
      )}
    </div>
  )
}

const FlatIconButton = forwardRef(function FlatIconButton({ onClick, active, label, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'p-1.5 rounded hover:bg-bg-hover transition-colors shrink-0',
        active ? 'text-bad' : 'text-ink-dim hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
})

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
function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}
function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}
function HeadphonesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  )
}
function DeafenedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M3 18v-6a9 9 0 0 1 15.3-6.4" />
      <path d="M21 15.3V12a9 9 0 0 0-.7-3.5" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  )
}
