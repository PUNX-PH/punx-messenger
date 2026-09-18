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
//
// Keyed by client_email, NOT a single fixed string. There are now two service
// accounts — punx-msg and punx-dtr — and a shared key would hand whichever
// token was cached first to both, so a read meant for one project would go out
// bearing the other's credentials and 403. Nothing about that failure would
// point at a cache.
const accessTokenCacheKey = (sa) => `sa-access-token:${sa.client_email}`

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
  const cacheKey = accessTokenCacheKey(sa)
  const cached = await env.JWKS_CACHE.get(cacheKey)
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
  await env.JWKS_CACHE.put(cacheKey, json.access_token, {
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

// The inverse of decodeValue, for the shapes this Worker writes. Same caveat:
// not a general encoder. A Date becomes a Firestore timestamp; `undefined` is
// rejected rather than silently dropped, because a field that vanishes from a
// message is worse than a loud failure.
function encodeValue(v) {
  if (v === null) return { nullValue: null }
  if (v === undefined) throw new AuthError('Cannot encode undefined for Firestore', 500)
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } }
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } }
  throw new AuthError(`Cannot encode ${typeof v} for Firestore`, 500)
}

export function encodeFields(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) out[k] = encodeValue(v)
  return out
}

const docsUrl = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`

/**
 * Read one document by path (e.g. `bots/abc123`). Returns null if missing.
 *
 * projectId defaults to this Worker's own project so existing callers are
 * unchanged; the DTR reminder passes punx-dtr's explicitly.
 */
export async function firestoreGet(env, sa, docPath, projectId = env.FIREBASE_PROJECT_ID) {
  const token = await getAccessToken(env, sa)
  const res = await fetch(`${docsUrl(projectId)}/${docPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new AuthError(`Firestore read failed (${res.status}) for ${docPath}`, 502)
  const json = await res.json()
  return decodeFields(json.fields || {})
}

/**
 * Run a structured query. Returns `[{ id, ...fields }]`.
 *
 * Firestore streams runQuery results as an array of envelopes, and the empty
 * result is a single envelope with NO `document` key rather than an empty
 * array — so the filter below is load-bearing, not defensive.
 */
export async function firestoreQuery(env, sa, structuredQuery, projectId = env.FIREBASE_PROJECT_ID) {
  const token = await getAccessToken(env, sa)
  const res = await fetch(`${docsUrl(projectId)}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  })
  if (!res.ok) throw new AuthError(`Firestore query failed (${res.status})`, 502)
  const rows = await res.json()
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r.document)
    .map(r => ({ id: r.document.name.split('/').pop(), ...decodeFields(r.document.fields || {}) }))
}

/**
 * Merge-write a document with a caller-supplied bearer token.
 *
 * `bearer` is the point of this function. Passed a SERVICE-ACCOUNT token it
 * bypasses firestore.rules entirely; passed a bot's ID token the write is
 * evaluated against the rules like any client's. The bot platform chose the
 * second deliberately over service-account bots, so anything writing as a bot
 * must hand in an ID token — see mintBotIdToken.
 *
 * updateMask is what makes this a merge: without it Firestore REST PATCH
 * REPLACES the document, so bumping lastMessageAt on a DM would wipe its
 * members array and lock both people out of their own conversation.
 */
export async function firestoreMerge(bearer, projectId, docPath, fields) {
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&')
  const res = await fetch(`${docsUrl(projectId)}/${docPath}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encodeFields(fields) }),
  })
  if (!res.ok) {
    throw new AuthError(`Firestore write failed (${res.status}) for ${docPath}: ${await res.text()}`, 502)
  }
  return res.json()
}

/** Service-account bearer, for reads and for writes that may bypass rules. */
export async function serviceAccountToken(env, sa) {
  return getAccessToken(env, sa)
}

/**
 * Sign in as a bot and return a Firebase ID TOKEN, not a custom token.
 *
 * A custom token is only an assertion that the holder may become `uid`;
 * Firestore will not accept one. Exchanging it at identitytoolkit produces the
 * ID token that firestore.rules actually evaluates — so the bot's writes are
 * subject to botCan() and its granted scopes, exactly like a bot connecting
 * from the browser SDK.
 *
 * Needs the Firebase WEB api key, which is the public one already shipped in
 * the client bundle, not a secret.
 */
export async function mintBotIdToken(env, sa, botUid) {
  if (!env.FIREBASE_WEB_API_KEY) {
    throw new AuthError('FIREBASE_WEB_API_KEY is unset, so no bot can sign in', 503)
  }
  const customToken = await mintCustomToken(sa, botUid, { bot: true })
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  )
  if (!res.ok) {
    throw new AuthError(`Bot sign-in failed (${res.status}): ${await res.text()}`, 502)
  }
  return (await res.json()).idToken
}

// ---- config ----

/**
 * The service account JSON, whole, as the FIREBASE_SERVICE_ACCOUNT secret.
 * Absent means bot auth simply isn't configured on this Worker — a 503 with a
 * plain explanation beats a stack trace, since that's the expected state
 * until someone sets the secret.
 */
export function loadServiceAccount(env, varName = 'FIREBASE_SERVICE_ACCOUNT') {
  if (!env[varName]) {
    throw new AuthError(`Not configured on this Worker (${varName} is unset)`, 503)
  }
  let sa
  try {
    sa = JSON.parse(env[varName])
  } catch (e) {
    throw new AuthError(`${varName} is not valid JSON: ${e.message}`, 503)
  }
  if (!sa.client_email || !sa.private_key) {
    throw new AuthError(`${varName} is missing client_email/private_key`, 503)
  }
  return sa
}
