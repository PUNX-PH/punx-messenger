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

// Role hierarchy, highest first: developer > super_admin > admin > employee.
//
// `developer` holds everything super_admin does; what makes it the top tier is
// the one thing it has that super_admin doesn't — groups a developer OWNS are
// invisible and untouchable to super admins who aren't members (see
// isOversightExempt below, and the developer boundary in firestore.rules).
export const isSuperAdmin = (p) => p?.role === 'super_admin'
export const isDeveloper = (p) => p?.role === 'developer'

// Bottom of the hierarchy. A guest is a group member whose channel access is
// explicit-only: they see nothing in a group except channels whose allowUids
// names them. Mirrors isGuest() in firestore.rules.
export const isGuest = (p) => p?.role === 'guest'

// "Runs the workspace itself": role administration, the bot registry, and
// see-all-channels oversight.
export const isTopTier = (p) => isDeveloper(p) || isSuperAdmin(p)

// "Manages groups and content": group settings, pinning and deleting anywhere,
// channel management. Developer is part of this too, being strictly above it.
export const isAdmin = (p) => p?.role === 'admin' || isTopTier(p)

export const canManageBots = (p) => isAdmin(p)
export const canManageRoles = (p) => isTopTier(p)
export const canOversee = (p) => isTopTier(p)

const uidOf = (p) => p?.id || p?.uid || null

/**
 * Who may grant or revoke the `developer` role. Developers only — if a super
 * admin could demote a developer, the group protection above would be one
 * click from being bypassed. The bootstrap account is the escape hatch, since
 * otherwise the very first developer could never be created.
 * Mirrors developerRoleChangeAllowed() in firestore.rules.
 */
export const canGrantDeveloper = (p) =>
  isDeveloper(p) || SUPER_ADMINS.includes((p?.email || '').toLowerCase())

/**
 * True for a group that super-admin oversight must not reach into: one OWNED
 * by a developer. Needs the user directory to resolve the owner's role, so
 * callers pass `useUsers().byId`.
 *
 * Note this deliberately has no "unless I'm a developer" exemption — one
 * developer does not get to read another's group either. Being a MEMBER is the
 * only way in, which is what callers check separately.
 */
export const isOversightExempt = (group, usersById) =>
  !!group && usersById?.[group.ownerUid]?.role === 'developer'

/**
 * Whether `profile` may see `channel`. Mirrors channelVisible() in
 * firestore.rules — keep the two in step, since this one decides what the
 * sidebar renders and that one decides what Firestore will actually serve.
 *
 *   guest      → only channels whose allowUids names them, private or not.
 *   anyone else→ every channel except private ones they aren't listed in;
 *                group and workspace admins see private ones too.
 *
 * A channel with no `private` field is public — channels created before this
 * feature have no such field and must keep working.
 */
export const canSeeChannel = (profile, channel, group) => {
  if (!channel) return false
  const uid = uidOf(profile)
  const listed = (channel.allowUids || []).includes(uid)
  if (isGuest(profile)) return listed
  if (!channel.private) return true
  return listed || isAdmin(profile) || !!group?.adminUids?.includes(uid)
}

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
  canOversee(profile) && !!group && !(group.memberUids || []).includes(uidOf(profile))
