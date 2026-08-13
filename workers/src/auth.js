// Verifies Firebase Auth ID tokens without firebase-admin (not Workers-compatible).
// Mirrors firestore.rules' signedIn() domain check — used only to gate the
// Klipy GIF proxy routes against random internet traffic, nothing else.

const JWKS_URL = 'https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com'
const JWKS_CACHE_KEY = 'firebase-jwks'
const JWKS_DEFAULT_TTL = 3600

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message)
    this.status = status
  }
}

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function base64UrlDecodeJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64url)))
}

async function getJwks(env) {
  const cached = await env.JWKS_CACHE.get(JWKS_CACHE_KEY)
  if (cached) return JSON.parse(cached)

  const res = await fetch(JWKS_URL)
  if (!res.ok) throw new AuthError(`Failed to fetch Firebase JWKS: ${res.status}`, 502)
  const jwks = await res.json()

  const maxAgeMatch = (res.headers.get('cache-control') || '').match(/max-age=(\d+)/)
  const ttl = maxAgeMatch ? Math.max(60, parseInt(maxAgeMatch[1], 10)) : JWKS_DEFAULT_TTL
  await env.JWKS_CACHE.put(JWKS_CACHE_KEY, JSON.stringify(jwks), { expirationTtl: ttl })

  return jwks
}

function isEmailAllowed(email, env) {
  const domain = env.ALLOWED_EMAIL_DOMAIN || 'punx.ai'
  const extras = (env.ALLOWED_EXTRA_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const e = (email || '').toLowerCase()
  return e.endsWith('@' + domain) || extras.includes(e)
}

// Accepts either a Request (reads its Authorization header) or a raw token
// string (the WebSocket upgrade path, where the token travels as a query
// param since browsers can't set custom headers on a WS handshake).
export async function verifyAuth(requestOrToken, env) {
  const token = typeof requestOrToken === 'string'
    ? requestOrToken
    : (requestOrToken.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')

  if (!token) throw new AuthError('Missing bearer token', 401)

  const parts = token.split('.')
  if (parts.length !== 3) throw new AuthError('Malformed token', 401)
  const [headerB64, payloadB64, sigB64] = parts

  const header = base64UrlDecodeJson(headerB64)
  if (header.alg !== 'RS256') throw new AuthError('Unsupported token algorithm', 401)

  const payload = base64UrlDecodeJson(payloadB64)
  const now = Math.floor(Date.now() / 1000)
  const projectId = env.FIREBASE_PROJECT_ID

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('Bad issuer', 401)
  if (payload.aud !== projectId) throw new AuthError('Bad audience', 401)
  if (typeof payload.exp !== 'number' || payload.exp < now - 5) throw new AuthError('Token expired', 401)
  if (typeof payload.iat !== 'number' || payload.iat > now + 5) throw new AuthError('Token not yet valid', 401)
  if (!payload.sub) throw new AuthError('Missing subject claim', 401)

  const jwks = await getJwks(env)
  const jwk = jwks.keys.find(k => k.kid === header.kid)
  if (!jwk) throw new AuthError('Unknown signing key', 401)

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  )
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key,
    base64UrlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  )
  if (!valid) throw new AuthError('Invalid signature', 401)

  if (!isEmailAllowed(payload.email, env)) throw new AuthError('Email domain not allowed', 403)

  return {
    uid: payload.sub,
    email: (payload.email || '').toLowerCase(),
    name: payload.name || payload.email?.split('@')[0] || 'User',
    photoURL: payload.picture || null,
  }
}
