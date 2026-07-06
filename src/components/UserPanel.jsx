import { Link } from 'react-router-dom'
import { useAuth, isSuperAdmin } from '../lib/auth'
import Avatar from './Avatar'
import { roleLabel } from '../lib/users'
import { computeStatus, useTickNow } from '../lib/presence'
import { useUsers } from '../lib/users'
import { useNotifications } from '../lib/notifications'

export default function UserPanel() {
  const { profile, signOut } = useAuth()
  const { byId } = useUsers()
  const { supported: notifSupported, permission: notifPerm, request: requestNotifPerm } = useNotifications()
  const now = useTickNow()
  const me = byId[profile?.id] || profile
  const status = computeStatus(me, now)
  return (
    <div className="h-14 bg-bg-deepest border-t border-line-subtle px-2 flex items-center gap-2 shrink-0">
      <Avatar name={profile?.name} src={profile?.photoURL} size={32} status={status} ringColor="border-bg-deepest" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{profile?.name}</div>
        <div className="text-xs text-ink-dim truncate">{roleLabel(profile?.role)}</div>
      </div>

      {notifSupported && (
        <button
          onClick={notifPerm === 'default' ? requestNotifPerm : undefined}
          title={
            notifPerm === 'granted' ? 'Notifications on'
            : notifPerm === 'denied' ? 'Notifications blocked (change in browser settings)'
            : 'Enable notifications'
          }
          disabled={notifPerm === 'denied'}
          className={[
            'p-1.5 rounded hover:bg-bg-hover transition-colors',
            notifPerm === 'granted' ? 'text-brand'
              : notifPerm === 'denied' ? 'text-ink-dim opacity-50 cursor-not-allowed'
              : 'text-ink-dim hover:text-ink',
          ].join(' ')}
        >
          {notifPerm === 'denied' ? <BellOffIcon /> : <BellIcon />}
        </button>
      )}

      {isSuperAdmin(profile) && (
        <Link
          to="/admin"
          title="Admin panel"
          className="text-ink-dim hover:text-warn p-1.5 rounded hover:bg-bg-hover transition-colors"
        >
          <ShieldIcon />
        </Link>
      )}

      <button
        onClick={signOut}
        title="Sign out"
        className="text-ink-dim hover:text-ink p-1.5 rounded hover:bg-bg-hover transition-colors"
      >
        <SignOutIcon />
      </button>
    </div>
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
