import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  clearPendingInvite, fetchInvite, inviteIsLive, redeemInvite, setPendingInvite,
} from '../lib/invites'

/**
 * /invite/:token — the screen someone lands on from an invite link.
 *
 * Reachable while signed out AND while signed in without a profile, which is
 * the state an invited outsider is in: they have a Google account we've never
 * seen, so firestore.rules gives them nothing until they redeem. See Gate in
 * App.jsx for why this route sits outside the usual login wall.
 *
 * The invite itself is only readable once authenticated (the rules require
 * request.auth != null), which is deliberate: a link that leaks shouldn't tell
 * a stranger — or a crawler — that punx.ai has a channel called #payroll. So
 * the pre-sign-in screen is intentionally vague, and details appear after.
 */
export default function InviteAccept() {
  const { token } = useParams()
  const { user, profile, signIn, authError } = useAuth()
  const [invite, setInvite] = useState(undefined) // undefined = loading
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(false)

  // Park the token before the Google round trip: an unrecognised address is
  // otherwise indistinguishable from a stranger, and AuthProvider would sign
  // them straight back out. See getPendingInvite there.
  useEffect(() => { if (token) setPendingInvite(token) }, [token])

  useEffect(() => {
    if (!user || !token) return
    let live = true
    fetchInvite(token)
      .then(inv => { if (live) setInvite(inv) })
      .catch(e => { if (live) { setInvite(null); setError(e.message) } })
    return () => { live = false }
  }, [user, token])

  const join = async () => {
    setJoining(true); setError(null)
    try {
      const res = await redeemInvite({ token, invite, user, existingProfile: profile })
      clearPendingInvite()
      // Full navigation rather than a router push: a brand-new guest has no
      // profile in memory yet (AuthProvider left it null because there was no
      // users doc to read), and reloading is the honest way to pick up the one
      // redemption just created.
      const first = res.channelIds[0]
      window.location.assign(first ? `/g/${res.groupId}/c/${first}` : `/g/${res.groupId}`)
    } catch (e) {
      setJoining(false)
      setError(
        e?.code === 'permission-denied'
          ? "This invite couldn't be redeemed. It may have been revoked or expired just now."
          : e.message
      )
    }
  }

  // ── Signed out: say as little as possible ──
  if (!user) {
    return (
      <Frame title="You've been invited">
        <p className="text-sm text-ink-muted">
          Someone shared a channel with you on Punx Messenger. Sign in with Google to see
          the invitation — any Google account works.
        </p>
        {authError && <Err>{authError}</Err>}
        <button
          onClick={signIn}
          className="mt-5 w-full px-4 py-2.5 rounded-md bg-brand text-white font-medium hover:opacity-90 transition-opacity"
        >
          Continue with Google
        </button>
      </Frame>
    )
  }

  if (invite === undefined) {
    return <Frame title="Checking your invitation"><p className="text-sm text-ink-muted">One moment…</p></Frame>
  }

  if (!invite) {
    return (
      <Frame title="Invitation not found">
        <p className="text-sm text-ink-muted">
          This link doesn't match any invitation. Check you copied the whole thing, or ask
          whoever sent it for a new one.
        </p>
        {error && <Err>{error}</Err>}
      </Frame>
    )
  }

  if (!inviteIsLive(invite)) {
    return (
      <Frame title={invite.revoked ? 'Invitation revoked' : 'Invitation expired'}>
        <p className="text-sm text-ink-muted">
          {invite.revoked
            ? 'This link has been turned off by an admin.'
            : 'This link has passed its expiry date.'}{' '}
          Ask for a fresh one.
        </p>
      </Frame>
    )
  }

  const names = invite.channelNames || []
  return (
    <Frame title={`Join ${invite.groupName}`}>
      <p className="text-sm text-ink-muted">
        You've been invited to {names.length === 1 ? 'this channel' : 'these channels'} in{' '}
        <span className="text-ink font-medium">{invite.groupName}</span>:
      </p>
      <ul className="mt-3 mb-1 space-y-1">
        {names.map((n, i) => (
          <li key={i} className="text-sm text-ink flex items-center gap-2">
            <span className="text-ink-dim">#</span>{n}
          </li>
        ))}
      </ul>
      {!profile && (
        <p className="mt-4 text-xs text-ink-dim">
          You'll join as a guest, which means you'll see these channels and nothing else in
          the workspace.
        </p>
      )}
      {error && <Err>{error}</Err>}
      <button
        onClick={join}
        disabled={joining}
        className="mt-5 w-full px-4 py-2.5 rounded-md bg-brand text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {joining ? 'Joining…' : 'Accept invitation'}
      </button>
      <p className="mt-3 text-xs text-ink-dim text-center">
        Signed in as {user.email}
      </p>
    </Frame>
  )
}

function Frame({ title, children }) {
  return (
    <div className="min-h-screen grid place-items-center bg-bg-main px-6">
      <div className="w-full max-w-sm">
        <div className="text-xs uppercase tracking-wider text-ink-dim font-semibold mb-2">
          Punx Messenger
        </div>
        <h1 className="text-xl font-semibold text-ink mb-3">{title}</h1>
        {children}
      </div>
    </div>
  )
}

function Err({ children }) {
  return (
    <div className="mt-4 text-sm text-bad bg-bad/10 border border-bad/20 rounded-md px-3 py-2">
      {children}
    </div>
  )
}
