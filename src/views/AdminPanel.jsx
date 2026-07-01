import { useEffect, useMemo, useState } from 'react'
import { useAuth, isSuperAdmin } from '../lib/auth'
import { listenAllUsers, roleLabel, ROLES, setUserRole } from '../lib/users'
import Avatar from '../components/Avatar'
import RoleBadge from '../components/RoleBadge'
import { MenuButton } from '../components/AppShell'

export default function AdminPanel() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [filter, setFilter] = useState('')
  const [busyUid, setBusyUid] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => listenAllUsers(setUsers), [])

  if (!isSuperAdmin(profile)) {
    return (
      <main className="flex-1 grid place-items-center bg-bg-main">
        <div className="max-w-sm text-center px-6">
          <div className="text-lg font-semibold text-ink mb-2">Restricted</div>
          <p className="text-sm text-ink-muted">Only super admins can view this page.</p>
        </div>
      </main>
    )
  }

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return users.filter(u =>
      !f || u.name?.toLowerCase().includes(f) || u.email?.toLowerCase().includes(f)
    )
  }, [users, filter])

  const counts = useMemo(() => {
    const c = { super_admin: 0, admin: 0, employee: 0 }
    for (const u of users) c[u.role || 'employee']++
    return c
  }, [users])

  const onChangeRole = async (u, role) => {
    setError(null)
    if (u.id === profile.id && role !== 'super_admin') {
      setError('You can\'t demote yourself. Promote someone else first, then ask them to demote you.')
      return
    }
    setBusyUid(u.id)
    try { await setUserRole(u.id, role) }
    catch (e) { setError(e.message) }
    finally { setBusyUid(null) }
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-bg-main overflow-hidden">
      <header className="h-12 border-b border-line-subtle flex items-center px-3 md:px-4 gap-2 shadow-elev1 shrink-0">
        <MenuButton />
        <ShieldIcon />
        <span className="font-semibold">Admin panel</span>
        <span className="text-ink-dim text-sm ml-3 border-l border-line-subtle pl-3 hidden sm:inline">
          Workspace members &amp; roles
        </span>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="max-w-3xl mx-auto">

          <div className="grid grid-cols-3 gap-3 mb-6">
            <Stat label="Super admins" value={counts.super_admin} accent="text-warn" />
            <Stat label="Admins"       value={counts.admin}       accent="text-brand" />
            <Stat label="Employees"    value={counts.employee}    accent="text-ink" />
          </div>

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">All members</h2>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter by name or email"
              className="bg-bg-deepest border border-line-subtle rounded-md px-3 py-1.5 text-sm w-64 outline-none focus:border-brand"
            />
          </div>

          {error && (
            <div className="mb-3 text-sm text-bad bg-bad/10 border border-bad/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="bg-bg-raised border border-line-subtle rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-ink-dim border-b border-line-subtle bg-bg-deepest font-semibold">
              <div>Member</div>
              <div>Current role</div>
              <div className="text-right">Change to</div>
            </div>
            {visible.map(u => (
              <div key={u.id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 items-center border-b border-line-subtle last:border-b-0 hover:bg-bg-hover/50">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={u.name} src={u.photoURL} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      <span className="truncate">{u.name}</span>
                      {u.id === profile.id && (
                        <span className="text-[10px] text-ink-dim">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-dim truncate">{u.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <RoleBadge role={u.role || 'employee'} />
                  {(!u.role || u.role === 'employee') && (
                    <span className="text-xs text-ink-dim">{roleLabel('employee')}</span>
                  )}
                </div>
                <div className="text-right">
                  <select
                    disabled={busyUid === u.id}
                    value={u.role || 'employee'}
                    onChange={(e) => onChangeRole(u, e.target.value)}
                    className="bg-bg-deepest border border-line-subtle rounded-md px-2 py-1 text-sm outline-none focus:border-brand disabled:opacity-50"
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{roleLabel(r)}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}

            {visible.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-ink-muted">
                {users.length === 0 ? 'Loading…' : 'No match for that filter.'}
              </div>
            )}
          </div>

          <p className="text-xs text-ink-dim mt-6">
            <strong className="text-ink-muted">Hierarchy:</strong> Super admins manage the workspace and other admins.
            Admins can pin in any channel and manage any group. Employees join groups by invitation.
          </p>
        </div>
      </div>
    </main>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className="bg-bg-raised border border-line-subtle rounded-lg px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-dim font-semibold">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
    </div>
  )
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warn" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}
