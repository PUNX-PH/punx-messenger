import { verifyAuth, AuthError } from '../auth.js'

// Short-lived TURN credentials for WebRTC, minted per signed-in user.
//
// Why a server route at all, when the STUN-only list it replaces was just a
// build-time constant: Cloudflare issues TURN credentials that EXPIRE, from a
// long-lived key that must never reach a browser. Baking that key into the
// client bundle would let anyone relay traffic billed to this account, and
// baking in a generated credential would work only until it expired.
//
// So the key stays here as a Worker secret, and every client asks for its own
// credential the same way it already asks for GIFs — with the Firebase ID
// token it already has. See src/lib/webrtc.js and AppConfig.iceServers.
const CF_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys'

// Long enough to outlast any realistic call, so nothing has to refresh
// mid-conversation, and short enough that a leaked credential ages out.
const TTL_SECONDS = 24 * 60 * 60

export async function issueIceServers(request, env) {
  await verifyAuth(request, env)

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    // Deliberately not fatal. The clients treat a failure here as "no TURN
    // available" and fall back to STUN-only, which is exactly the behaviour
    // they had before this route existed — so a missing secret degrades voice
    // for hard-to-reach pairs rather than breaking it for everyone.
    throw new AuthError('TURN is not configured', 503)
  }

  const res = await fetch(
    `${CF_TURN_API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    },
  )

  if (!res.ok) {
    // The upstream body can name the key, so it is logged rather than
    // returned. Callers only need to know it did not work.
    console.error('[turn] credential mint failed:', res.status, await res.text())
    throw new AuthError('Could not issue TURN credentials', 502)
  }

  const data = await res.json()
  // Cloudflare returns { iceServers: {...} | [...] }. Normalise to the array
  // RTCPeerConnection wants, so neither client has to care which it got.
  const raw = data?.iceServers
  const iceServers = Array.isArray(raw) ? raw : raw ? [raw] : []
  if (iceServers.length === 0) {
    console.error('[turn] mint returned no iceServers:', JSON.stringify(data))
    throw new AuthError('Could not issue TURN credentials', 502)
  }

  return Response.json(
    { iceServers, ttl: TTL_SECONDS },
    {
      // Credentials are per-user and time-limited: never let a shared cache
      // hand one user's credential to somebody else.
      headers: { 'Cache-Control': 'private, no-store' },
    },
  )
}
