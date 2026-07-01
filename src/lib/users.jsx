import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './auth'

export const ROLES = ['employee', 'admin', 'super_admin']

export const roleLabel = (r) =>
  r === 'super_admin' ? 'Super admin' : r === 'admin' ? 'Admin' : 'Employee'

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

// ---------- Shared users context ----------
const UsersCtx = createContext({ users: [], byId: {} })

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

  return <UsersCtx.Provider value={{ users, byId }}>{children}</UsersCtx.Provider>
}

export const useUsers = () => useContext(UsersCtx)

