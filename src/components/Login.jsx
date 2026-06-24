import { useAuth } from '../lib/auth'
import { ALLOWED_DOMAIN } from '../lib/firebase'

export default function Login() {
  const { signIn, authError, firebaseConfigured } = useAuth()
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-deepest px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-md bg-brand grid place-items-center font-bold text-white text-lg">P</div>
          <div>
            <div className="text-lg font-semibold tracking-tight">Punx Messenger</div>
            <div className="text-xs text-ink-dim">Internal communication</div>
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-2 tracking-tight">Sign in</h1>
        <p className="text-sm text-ink-muted mb-8">
          Restricted to <span className="text-ink">@{ALLOWED_DOMAIN}</span> accounts.
        </p>

        <button
          onClick={signIn}
          className="w-full inline-flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-900 font-medium py-2.5 rounded-md transition-colors duration-150"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        {authError && (
          <div className="mt-4 text-sm text-bad bg-bad/10 border border-bad/20 rounded-md px-3 py-2">
            {authError}
          </div>
        )}

        {!firebaseConfigured && (
          <div className="mt-4 text-sm text-warn bg-warn/10 border border-warn/20 rounded-md px-3 py-2 leading-relaxed">
            <div className="font-medium mb-1">Firebase not configured</div>
            Copy <code className="text-ink">.env.example</code> → <code className="text-ink">.env.local</code> and paste your Firebase config, then restart <code className="text-ink">npm run dev</code>.
          </div>
        )}

        <div className="mt-12 text-xs text-ink-dim">
          By signing in you agree to our internal acceptable-use policy.
        </div>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.16.29-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/>
    </svg>
  )
}
