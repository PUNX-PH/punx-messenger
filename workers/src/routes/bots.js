// The bot access point: trade a long-lived API key for a short-lived Firebase
// credential.
//
//   POST /bot/token   { "apiKey": "punxbot_<botUid>_<secret>" }
//     → 200 { "token": "<custom token>", "uid": "<botUid>", "expiresIn": 3600 }
//
// The bot passes `token` to signInWithCustomToken() and from then on uses the
// ordinary Firebase SDK — realtime listeners included — with firestore.rules
// scoping it exactly as far as its registry doc allows. See docs/BOTS.md.
//
// Deliberately NOT behind verifyAuth(): this is where a bot with no session
// yet comes to get one, so the API key is the credential. Everything the bot
// does afterwards is authenticated by the minted token instead.

import { AuthError } from '../auth.js'
import { firestoreGet, loadServiceAccount, mintCustomToken } from '../googleAuth.js'

const KEY_PREFIX = 'punxbot_'
const TOKEN_TTL_SECONDS = 3600

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Compares in constant time. Both sides here are fixed-length hex digests, so
// a length mismatch is already a definite no — the loop is about not leaking
// *where* two same-length hashes diverge.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// punxbot_<botUid>_<hex secret>. The uid travels inside the key so verifying
// one costs a single document read instead of a scan of the whole registry.
// Split on the LAST underscore: the secret is hex and can't contain one, while
// a generated uid conceivably could.
function parseApiKey(apiKey) {
  if (!apiKey.startsWith(KEY_PREFIX)) return null
  const rest = apiKey.slice(KEY_PREFIX.length)
  const sep = rest.lastIndexOf('_')
  if (sep <= 0) return null
  const botUid = rest.slice(0, sep)
  const secret = rest.slice(sep + 1)
  // Bound the uid before it reaches a Firestore path, so a hostile key can't
  // steer the read somewhere else entirely.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(botUid)) return null
  if (!/^[0-9a-f]{32,128}$/.test(secret)) return null
  return { botUid }
}

export async function issueBotToken(request, env) {
  const body = await request.json().catch(() => ({}))
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

  const parsed = parseApiKey(apiKey)
  // One message for every malformed/unknown/wrong-secret case, so this can't
  // be used to enumerate which bot ids exist.
  const rejected = new AuthError('Invalid bot API key', 401)
  if (!parsed) throw rejected

  const sa = loadServiceAccount(env)

  const bot = await firestoreGet(env, sa, `bots/${parsed.botUid}`)
  if (!bot) throw rejected
  // Disabled is worth distinguishing: the key is right, and a bot author
  // staring at a 401 would otherwise go looking in entirely the wrong place.
  if (bot.enabled !== true) throw new AuthError('This bot is disabled', 403)

  const credentials = await firestoreGet(env, sa, `bots/${parsed.botUid}/private/credentials`)
  if (!credentials?.keyHash) throw rejected
  if (!timingSafeEqual(await sha256Hex(apiKey), credentials.keyHash)) throw rejected

  const token = await mintCustomToken(sa, parsed.botUid, {
    // What firestore.rules' isBot() keys off. Nothing else in the token is
    // load-bearing: scopes and enabled are re-read from the registry doc on
    // every single request, so revoking either takes effect within seconds
    // rather than whenever this token happens to expire.
    bot: true,
    botName: bot.name || 'Bot',
  })

  return Response.json({ token, uid: parsed.botUid, expiresIn: TOKEN_TTL_SECONDS })
}
