import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import {
  auth, db, googleProvider, firebaseConfigured,
  ALLOWED_DOMAIN, ALLOWED_EXTRA_EMAILS, SUPER_ADMINS, isEmailAllowed,
} from './firebase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)       // firebase user
  const [profile, setProfile] = useState(null) // /users/{uid} doc
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    if (!firebaseConfigured) { setLoading(false); return }
    return onAuthStateChanged(auth, async (u) => {
      setAuthError(null)
      if (!u) { setUser(null); setProfile(null); setLoading(false); return }

      const email = (u.email || '').toLowerCase()
      if (!isEmailAllowed(email)) {
        await fbSignOut(auth)
        const extras = ALLOWED_EXTRA_EMAILS.length
          ? ` Some external addresses are also allowed.`
          : ''
        setAuthError(`Only @${ALLOWED_DOMAIN} accounts can sign in.${extras}`)
        setLoading(false)
        return
      }

      try {
        const ref = doc(db, 'users', u.uid)
        const snap = await getDoc(ref)
        const isSuper = SUPER_ADMINS.includes(email)
        if (!snap.exists()) {
          await setDoc(ref, {
            uid: u.uid,
            email,
            name: u.displayName || email.split('@')[0],
            photoURL: u.photoURL || null,
            role: isSuper ? 'super_admin' : 'employee',
            createdAt: serverTimestamp(),
            lastSeen: serverTimestamp(),
          })
        } else {
          // Existing user: refresh display fields only. Role is managed by super_admin
          // via the admin panel and locked down by Firestore rules.
          await setDoc(ref, {
            name: u.displayName || snap.data().name,
            photoURL: u.photoURL || snap.data().photoURL || null,
            lastSeen: serverTimestamp(),
          }, { merge: true })
        }
        const fresh = await getDoc(ref)
        setUser(u)
        setProfile({ id: u.uid, ...fresh.data() })
      } catch (e) {
        console.error('[auth] profile sync failed:', e)
        await fbSignOut(auth)
        setAuthError(
          e?.code === 'permission-denied'
            ? 'Firestore rules are blocking your user profile. Paste the dev rules in Firebase Console → Firestore → Rules and Publish.'
            : `Sign-in failed: ${e?.message || e}`
        )
      } finally {
        setLoading(false)
      }
    })
  }, [])

  const signIn = async () => {
    if (!firebaseConfigured) { setAuthError('Firebase is not configured. Add your credentials to .env.local.'); return }
    setAuthError(null)
    try { await signInWithPopup(auth, googleProvider) }
    catch (e) { setAuthError(e.message) }
  }
  const signOut = () => firebaseConfigured && fbSignOut(auth)

  return (
    <AuthCtx.Provider value={{ user, profile, loading, authError, signIn, signOut, firebaseConfigured }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)

export const isAdmin = (p) => p?.role === 'admin' || p?.role === 'super_admin'
export const isSuperAdmin = (p) => p?.role === 'super_admin'
export const isDeveloper = (p) => p?.role === 'developer'

// Developers exist to run the bot platform (see docs/BOTS.md) without being
// handed the workspace: they reach the admin panel's Bots section and nothing
// else — no role changes, no group or member management, no oversight reads.
export const canManageBots = (p) => isDeveloper(p) || isAdmin(p)

const uidOf = (p) => p?.id || p?.uid || null

/**
 * Super-admin oversight ("ghost") viewing — reading a group you were never
 * added to. A super admin sees every channel in the workspace, but stays
 * absent from that group's memberUids while doing it, so member lists, voice
 * rosters and mention pickers never show them there.
 *
 * That invisibility is only real if they also can't WRITE: a message, a
 * reaction, a typing indicator or a voice join would each announce them
 * instantly. So every write surface asks this and turns itself off — see
 * ChatSurface's readOnly, ChannelSidebar's canManage, VoiceChannelRoom's join
 * button. To actually speak, add yourself to the group.
 *
 * Mirrors canOverseeAll() in firestore.rules, which is what grants the reads.
 * Returns false for a group you ARE in, so a super admin who is a real member
 * behaves exactly as before.
 */
export const isGhost = (profile, group) =>
  isSuperAdmin(profile) && !!group && !(group.memberUids || []).includes(uidOf(profile))
