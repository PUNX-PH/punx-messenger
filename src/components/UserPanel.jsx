import { Link } from 'react-router-dom'
import { useAuth, isSuperAdmin } from '../lib/auth'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import { roleLabel } from '../lib/users'

export default function UserPanel() {
  const { profile, signOut } = useAuth()
  return (
    <div className="h-14 bg-bg-deepest border-t border-line-subtle px-2 flex items-center gap-2 shrink-0">
      <Avatar name={profile?.name} src={profile?.photoURL} size={32} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          <span className="truncate">{profile?.name}</span>
          <RoleBadge role={profile?.role} size="xs" />
        </div>
        <div className="text-xs text-ink-dim truncate">{roleLabel(profile?.role)}</div>
      </div>

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
function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
