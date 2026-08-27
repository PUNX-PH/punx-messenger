import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  collection, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './auth'

// Low to high — the admin panel's role <select> renders them in this order.
// `developer` is the TOP role: everything super_admin has, plus the one thing
// super_admin doesn't have, which is that groups a developer owns are hidden
// from super admins. See lib/auth for who may grant it (developers only).
export const ROLES = ['guest', 'employee', 'admin', 'super_admin', 'developer']

export const roleLabel = (r) =>
  r === 'super_admin' ? 'Super admin'
    : r === 'admin' ? 'Admin'
      : r === 'developer' ? 'Developer'
        : r === 'guest' ? 'Guest'
          : 'Employee'

export function listenAllUsers(cb) {
  const q = query(collection(db, 'users'), orderBy('name'))
  return onSnapshot(q, snap =>
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  )
}

export async function setUserRole(uid, role) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`)
  await setDoc(doc(db, 'users', uid), { role }, { merge: true })
}

/** Removed from the workspace. Absent or false means active. */
export const isDeactivated = (u) => !!u?.deactivated

/**
 * Remove someone from the workspace, or put them back.
 *
 * Deactivation is the removal, not deletion: isHuman() in firestore.rules
 * refuses a deactivated account everything, so they can still sign into
 * Google and find the app has nothing for them. Deleting the document instead
 * would be undone by the person themselves — an @punx.ai address is admitted
 * on the strength of the address alone and recreates its own doc as `employee`
 * on the next sign-in. (For a guest a delete WOULD stick, since the document
 * is their only admission, but one mechanism beats two.)
 *
 * What it deliberately does not touch: their messages, and their membership of
 * groups and channels. History stays readable and attributed, memberships stay
 * inert while the account is refused, and reactivating restores exactly what
 * they had. Top tier only, and never a developer unless you are one — the
 * rules enforce both.
 *
 * Reactivating CLEARS the field rather than writing false, so an active
 * account is one with no deactivation state at all, however it got there.
 */
export async function setUserDeactivated(uid, deactivated, actorUid) {
  await setDoc(doc(db, 'users', uid), deactivated
    ? { deactivated: true, deactivatedAt: serverTimestamp(), deactivatedBy: actorUid || null }
    : { deactivated: deleteField(), deactivatedAt: deleteField(), deactivatedBy: deleteField() },
    { merge: true })
}

// ---------- Shared users context ----------
//
// Three shapes on purpose, and picking the wrong one is a visible bug:
//
//   byId        EVERY account, deactivated included. Resolving who wrote a
//               message, who is in a voice tile, who owns a group — identity
//               lookups must keep working for people who have left, or old
//               conversations lose their authors.
//   activeUsers people you can still pick: the DM list, the mention picker,
//               member panels, the add-members dialog.
//   users       the raw list, for the admin panel, which is the one screen
//               that has to show removed accounts in order to restore them.
const UsersCtx = createContext({ users: [], activeUsers: [], byId: {} })

export function UsersProvider({ children }) {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])

  useEffect(() => {
    if (!profile) return
    return listenAllUsers(setUsers)
  }, [profile])

  const byId = useMemo(() => {
    const m = {}
    for (const u of users) m[u.id] = u
    return m
  }, [users])

  const activeUsers = useMemo(() => users.filter(u => !isDeactivated(u)), [users])

  return (
    <UsersCtx.Provider value={{ users, activeUsers, byId }}>{children}</UsersCtx.Provider>
  )
}

export const useUsers = () => useContext(UsersCtx)
