// Service-account plumbing: mints Firebase custom tokens, and reads Firestore
// through the REST API.
//
// This is the ONLY code in the system holding a credential that bypasses
// firestore.rules, so it stays deliberately small and is reachable from
// exactly one place (routes/bots.js). Nothing here is exposed to the browser.
//
// Why the REST API rather than firebase-admin: the Admin SDK doesn't run on
// Workers (it needs Node crypto/gRPC). Custom tokens are just RS256-signed
// JWTs of a documented shape, and Web Crypto can sign those directly.

import { AuthError } from './auth.js'

// Fixed audience Firebase requires on a custom token — not a URL that's ever
// fetched, just the string identityToolkit expects to see.
const CUSTOM_TOKEN_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'
const TOKEN_TTL_SECONDS = 3600 // Firebase's own ceiling for a custom token
// Shares the JWKS cache namespace rather than asking for a second KV binding.
// Both are short-lived derived values, nothing that matters if evicted.
const ACCESS_TOKEN_CACHE_KEY = 'sa-access-token'

// ---- encoding helpers ----

function b64urlFromBytes(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlFromString(str) {
  return b64urlFromBytes(new TextEncoder().encode(str))
}

// Strips the PEM armour and newlines to get at the raw PKCS#8 DER. Tolerates
// both a private_key with real newlines and one that still has literal \n
// sequences, since which of those you end up with depends on how the service
// account JSON was pasted into the secret.
function pemToDer(pem) {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  return der
}

// ---- signing ----

async function signJwt(payload, sa) {
  const unsigned = `${b64urlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.`
    + b64urlFromString(JSON.stringify(payload))
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  return `${unsigned}.${b64urlFromBytes(new Uint8Array(sig))}`
}

/**
 * Mint a Firebase custom token. The bot hands this to
 * signInWithCustomToken(), and comes out the other side as `uid` with
 * `claims` merged into its ID token — which is how firestore.rules' isBot()
 * sees `request.auth.token.bot`.
 */
export function mintCustomToken(sa, uid, claims) {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: CUSTOM_TOKEN_AUD,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    uid,
    claims,
  }, sa)
}

// ---- Firestore REST ----

async function getAccessToken(env, sa) {
  const cached = await env.JWKS_CACHE.get(ACCESS_TOKEN_CACHE_KEY)
  if (cached) return cached

  const now = Math.floor(Date.now() / 1000)
  const assertion = await signJwt({
    iss: sa.client_email,
    scope: FIRESTORE_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  }, sa)

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    throw new AuthError(`Service-account token exchange failed: ${res.status}`, 502)
  }
  const json = await res.json()
  // Expire a minute early, so a cached token can't go stale mid-request.
  await env.JWKS_CACHE.put(ACCESS_TOKEN_CACHE_KEY, json.access_token, {
    expirationTtl: Math.max(60, (json.expires_in || TOKEN_TTL_SECONDS) - 60),
  })
  return json.access_token
}

// Firestore's REST API wraps every value in a type tag. Only the shapes the
// bot registry actually stores are handled — this is not a general decoder.
function decodeValue(v) {
  if ('stringValue' in v) return v.stringValue
  if ('booleanValue' in v) return v.booleanValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('timestampValue' in v) return v.timestampValue
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {})
  return null
}

function decodeFields(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v)
  return out
}

/** Read one document by path (e.g. `bots/abc123`). Returns null if missing. */
export async function firestoreGet(env, sa, docPath) {
  const token = await getAccessToken(env, sa)
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`
    + `/databases/(default)/documents/${docPath}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 404) return null
  if (!res.ok) throw new AuthError(`Firestore read failed (${res.status}) for ${docPath}`, 502)
  const json = await res.json()
  return decodeFields(json.fields || {})
}

// ---- config ----

/**
 * The service account JSON, whole, as the FIREBASE_SERVICE_ACCOUNT secret.
 * Absent means bot auth simply isn't configured on this Worker — a 503 with a
 * plain explanation beats a stack trace, since that's the expected state
 * until someone sets the secret.
 */
export function loadServiceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    throw new AuthError('Bot auth is not configured on this Worker (FIREBASE_SERVICE_ACCOUNT is unset)', 503)
  }
  let sa
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
  } catch (e) {
    throw new AuthError(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${e.message}`, 503)
  }
  if (!sa.client_email || !sa.private_key) {
    throw new AuthError('FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key', 503)
  }
  return sa
}
