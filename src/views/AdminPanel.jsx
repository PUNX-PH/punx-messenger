import { useEffect, useMemo, useState } from 'react'
import {
  useAuth, canGrantDeveloper, canManageBots, canManageRoles, isDeveloper, isTopTier,
} from '../lib/auth'
import { listenAllUsers, roleLabel, ROLES, setUserRole } from '../lib/users'
import Avatar from '../components/Avatar'
import BotsAdmin from '../components/BotsAdmin'
import RoleBadge from '../components/RoleBadge'
import { MenuButton } from '../components/AppShell'

export default function AdminPanel() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [filter, setFilter] = useState('')
  const [busyUid, setBusyUid] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => listenAllUsers(setUsers), [])

  // Two independent doors into this page. The top tier (developer and super
  // admin) gets role administration; plain admins get only the Bots section.
  const canSeeRoles = canManageRoles(profile)
  const canSeeBots = canManageBots(profile)
  // Only a developer (or the bootstrap account) may grant or revoke the
  // developer role — see canGrantDeveloper. A super admin therefore never gets
  // it as an option, and can't touch a row that already holds it.
  const mayGrantDev = canGrantDeveloper(profile)

  if (!canSeeRoles && !canSeeBots) {
    return (
      <main className="flex-1 grid place-items-center bg-bg-main">
        <div className="max-w-sm text-center px-6">
          <div className="text-lg font-semibold text-ink mb-2">Restricted</div>
          <p className="text-sm text-ink-muted">Only admins, super admins and developers can view this page.</p>
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

  // Seeded with every known role so a tier with nobody in it still renders 0,
  // and accumulated with a fallback so an unrecognised role can't turn a tile
  // into NaN.
  const counts = useMemo(() => {
    const c = { super_admin: 0, admin: 0, developer: 0, employee: 0 }
    for (const u of users) {
      const r = u.role || 'employee'
      c[r] = (c[r] || 0) + 1
    }
    return c
  }, [users])

  const onChangeRole = async (u, role) => {
    setError(null)
    // Locking yourself out of role administration is unrecoverable without
    // another top-tier account, so refuse it rather than let it through.
    if (u.id === profile.id && !isTopTier({ role })) {
      setError("You can't demote yourself out of the top tier. Promote someone else first, then ask them to demote you.")
      return
    }
    // Mirrors developerRoleChangeAllowed() in firestore.rules. Checked here
    // only so the refusal reads as an explanation rather than a bare
    // permission-denied; the rules are what actually enforce it.
    if ((role === 'developer' || isDeveloper(u)) && !mayGrantDev) {
      setError('Only a developer can grant or revoke the developer role.')
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
          {canSeeRoles ? 'Workspace members & roles' : 'Bots'}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="max-w-3xl mx-auto">

          {/* Everything down to the hierarchy note is role administration, so
              it is super-admin-only. A developer falls straight through to
              <BotsAdmin /> at the bottom. */}
          {canSeeRoles && (<>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Stat label="Developers"   value={counts.developer}   accent="text-ok" />
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
                    disabled={busyUid === u.id || (isDeveloper(u) && !mayGrantDev)}
                    title={isDeveloper(u) && !mayGrantDev
                      ? 'Only a developer can change a developer\'s role'
                      : undefined}
                    value={u.role || 'employee'}
                    onChange={(e) => onChangeRole(u, e.target.value)}
                    className="bg-bg-deepest border border-line-subtle rounded-md px-2 py-1 text-sm outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {/* `developer` is only offered to someone who may grant it,
                        so a super admin can't select an option the rules would
                        then reject. */}
                    {ROLES.filter(r => r !== 'developer' || mayGrantDev).map(r => (
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
            <strong className="text-ink-muted">Hierarchy:</strong> Developers hold everything a super admin
            does, and one thing more &mdash; groups a developer owns are invisible to super admins unless they're
            added, and only a developer can grant or revoke the developer role. Super admins manage the
            workspace and other admins, and can read every other channel without joining &mdash; invisibly,
            since they stay out of the member list until they're actually added. Admins can pin in any channel
            and manage any group. Employees join groups by invitation.
          </p>
          </>)}

          <BotsAdmin />
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
