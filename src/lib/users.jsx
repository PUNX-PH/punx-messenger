import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  collection, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './auth'
import { sameUsers, shareIdentity } from './usersIdentity'
import { watched } from './dataHealth'

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
  return onSnapshot(q, ...watched('people', snap =>
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  ))
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
//
// WHO people are and WHEN they were last around travel separately, on purpose.
// Every online person rewrites `lastSeen` every 45 seconds, and each write reaches
// every client as a snapshot. Folded into the user objects, that re-rendered every
// component reading this context (the message list, composer, both sidebars) each
// time anyone's heartbeat landed. So the objects here carry identity only and keep
// the SAME identity until a name, photo, role or the like changes (see
// lib/usersIdentity.js); presence lives in usePresence(), published in batches.
const UsersCtx = createContext({ users: [], activeUsers: [], byId: {} })

// uid -> { presence, lastSeen }. Read with computeStatus(presence[uid], now).
const PresenceCtx = createContext({})

// How often a changed presence map is published. Statuses are bucketed by minutes
// (away after 5, offline after 2 without a heartbeat) and drawn from a 30s tick, so
// a few seconds of lag is invisible, while ten people's heartbeats collapse from
// roughly one render every four seconds into at most one every fifteen.
const PRESENCE_FLUSH_MS = 15_000

export function UsersProvider({ children }) {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [presence, setPresence] = useState({})

  // Carried between snapshots so unchanged people keep their object identity.
  const identityRef = useRef(new Map())
  const usersRef = useRef([])
  const presenceRef = useRef({})
  const dirtyRef = useRef(false)
  // Read inside the listener, which must not be torn down when it changes.
  const meIdRef = useRef(profile?.id)
  meIdRef.current = profile?.id

  useEffect(() => {
    if (!profile) return
    identityRef.current = new Map() // a different account starts clean
    usersRef.current = []
    let first = true
    const unsubscribe = listenAllUsers(list => {
      const out = shareIdentity(identityRef.current, list, meIdRef.current)
      identityRef.current = out.next
      presenceRef.current = out.presence
      // Compared against a ref, not inside a setState updater: updaters must be
      // pure, and this one needs to set other state.
      const same = sameUsers(usersRef.current, out.users)
      if (!same) {
        usersRef.current = out.users
        setUsers(out.users)
      }
      // A render is happening anyway when the people changed, so publish presence
      // with it; otherwise leave it for the next flush.
      if (!same || first) {
        dirtyRef.current = false
        setPresence(out.presence)
      } else {
        dirtyRef.current = true
      }
      first = false
    })
    const flush = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setPresence(presenceRef.current)
    }, PRESENCE_FLUSH_MS)
    return () => { unsubscribe(); clearInterval(flush) }
  }, [profile])

  const byId = useMemo(() => {
    const m = {}
    for (const u of users) m[u.id] = u
    return m
  }, [users])

  const activeUsers = useMemo(() => users.filter(u => !isDeactivated(u)), [users])

  // Memoised: a fresh object each render would re-render every consumer whenever
  // the provider itself did, even with nothing new to show.
  const value = useMemo(() => ({ users, activeUsers, byId }), [users, activeUsers, byId])

  return (
    <UsersCtx.Provider value={value}>
      <PresenceCtx.Provider value={presence}>{children}</PresenceCtx.Provider>
    </UsersCtx.Provider>
  )
}

export const useUsers = () => useContext(UsersCtx)

/** uid -> { presence, lastSeen }, for computeStatus(presence[uid], now). */
export const usePresence = () => useContext(PresenceCtx)
