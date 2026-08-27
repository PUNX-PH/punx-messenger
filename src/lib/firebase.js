import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const cfg = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId)

export const app  = firebaseConfigured ? initializeApp(cfg) : null
export const auth = firebaseConfigured ? getAuth(app)       : null
export const db   = firebaseConfigured ? getFirestore(app)  : null
export const storage = firebaseConfigured ? getStorage(app) : null

/**
 * Local emulator mode — opt in with VITE_USE_EMULATORS=1 (see .env.example).
 *
 * This is how firestore.rules gets exercised through the real UI instead of by
 * reasoning about it: the Auth emulator's sign-in flow needs no password, and
 * the Firestore emulator loads this repo's firestore.rules verbatim, so a rule
 * that denies something shows up as the actual broken screen rather than as a
 * console line nobody reads.
 *
 * Guarded on a `demo-` project id, deliberately and non-negotiably. Firebase
 * treats that prefix as "never talks to a real backend", so a mistyped flag
 * can't point a seeding script or a destructive test at production data. If the
 * flag is set with a real project id we refuse and warn rather than connect.
 */
const useEmulators = import.meta.env.VITE_USE_EMULATORS === '1'
if (useEmulators && app) {
  if (!cfg.projectId?.startsWith('demo-')) {
    console.error(
      `[firebase] VITE_USE_EMULATORS=1 but projectId is "${cfg.projectId}", not a demo- project. ` +
      'Refusing to connect the emulators — this guard exists so emulator runs can never reach live data.'
    )
  } else {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    console.info('[firebase] emulator mode:', cfg.projectId)
  }
}

// `prompt: 'select_account'` on both, so somebody already signed into Google
// with the wrong account always gets the chooser rather than being silently
// reused. It's what makes "use a different account" work.
const makeGoogleProvider = (params) => {
  const p = new GoogleAuthProvider()
  p.setCustomParameters({ prompt: 'select_account', ...params })
  p.addScope('email')
  p.addScope('profile')
  return p
}

/**
 * Staff sign-in. `hd` prefills the company domain, which is a small kindness
 * for the accounts that make up nearly every sign-in.
 */
export const googleProvider = makeGoogleProvider({
  hd: import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || 'punx.ai',
})

/**
 * Invited outsiders — the same provider without `hd`.
 *
 * That parameter is not just a hint in the UI: Google renders the domain as a
 * fixed suffix on the email field, so the form reads as "only @punx.ai
 * addresses work here". On an invite screen that is the exact opposite of the
 * truth — any Google account can redeem a link — and guests were bouncing off
 * it. See InviteAccept.
 */
export const anyDomainGoogleProvider = makeGoogleProvider({})

export const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || 'punx.ai'
export const ALLOWED_EXTRA_EMAILS = (import.meta.env.VITE_ALLOWED_EXTRA_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
export const SUPER_ADMINS = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

export const isEmailAllowed = (email) => {
  const e = (email || '').toLowerCase()
  return e.endsWith('@' + ALLOWED_DOMAIN) || ALLOWED_EXTRA_EMAILS.includes(e)
}
