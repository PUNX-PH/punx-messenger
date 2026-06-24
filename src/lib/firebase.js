import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
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

export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({
  hd: import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || 'punx.ai',
  prompt: 'select_account',
})
googleProvider.addScope('email')
googleProvider.addScope('profile')

export const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || 'punx.ai'
export const SUPER_ADMINS = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
