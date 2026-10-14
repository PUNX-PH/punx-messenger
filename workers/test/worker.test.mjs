// Run with: npm test   (from workers/)
//
// Drives the Worker through its real `fetch` entry point against an in-memory
// Firestore. The crypto is real — an RSA key signs the service-account
// assertions — so token minting and the REST plumbing run the production paths.
// Regression tests for the issues found in the whole-project review:
// request-steered Firestore paths, the unvalidated `kind`, a partly failed send
// being marked complete, a non-constant-time secret check, junk tokens giving
// 500s, and the disabled-bot response leaking that a bot exists.

import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, test } from 'node:test'

import { secretsMatch } from '../src/auth.js'
import { encodeFields, firestoreGet, loadServiceAccount } from '../src/googleAuth.js'
import worker from '../src/index.js'

// ---------- fixtures ----------

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const SA = JSON.stringify({ client_email: 'sa@test.iam', private_key: PRIVATE_PEM })

const MSG = 'punx-test'
const DTR = 'punx-dtr'
const SECRET = 'trigger-secret-value'

const kv = new Map()
const env = () => ({
  FIREBASE_PROJECT_ID: MSG,
  DTR_PROJECT_ID: DTR,
  FIREBASE_WEB_API_KEY: 'web-key',
  FIREBASE_SERVICE_ACCOUNT: SA,
  DTR_SERVICE_ACCOUNT: SA,
  DTR_BOT_UID: 'dtr-bot-uid-1',
  DTR_TRIGGER_SECRET: SECRET,
  ALLOWED_EMAIL_DOMAIN: 'punx.ai',
  JWKS_CACHE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v) } },
})

// ---------- in-memory Firestore ----------

let docs        // `${project}|${path}` -> raw REST fields
let writes      // [{ project, path, search, fields }]
let failWrites  // (project, path) => boolean — simulate a refused write

const DOC_URL = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/([^/]+)\/databases\/\(default\)\/documents(?:\/(.*?))?(\?.*)?$/

function decode(v) {
  if ('stringValue' in v) return v.stringValue
  if ('booleanValue' in v) return v.booleanValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('timestampValue' in v) return v.timestampValue
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]))
  return undefined
}
const decodeFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]))
const seed = (project, path, obj) => { docs.set(`${project}|${path}`, encodeFields(obj)) }

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'sa-access', expires_in: 3600 })
  if (url.startsWith('https://identitytoolkit.googleapis.com/')) return json({ idToken: 'bot-id-token' })

  // `documents:runQuery` is glued to the collection root with a colon, not a
  // slash, so it has to be recognised before the path pattern below.
  const q = /\/projects\/([^/]+)\/databases\/\(default\)\/documents:runQuery$/.exec(url)
  if (q) {
    const project = q[1]
    const collection = JSON.parse(init.body).structuredQuery.from[0].collectionId
    const rows = [...docs.entries()]
      .filter(([k]) => k.startsWith(`${project}|${collection}/`) && k.split('/').length === 2)
      .map(([k, fields]) => ({ document: { name: `x/${k.split('/').pop()}`, fields } }))
    return json(rows.length ? rows : [{}])
  }

  const m = DOC_URL.exec(url)
  if (!m) throw new Error(`unexpected fetch in test: ${init.method || 'GET'} ${url}`)
  const [, project, rawPath = '', search = ''] = m

  const path = decodeURIComponent(rawPath)
  if ((init.method || 'GET') === 'GET') {
    return docs.has(`${project}|${path}`) ? json({ fields: docs.get(`${project}|${path}`) }) : new Response('{}', { status: 404 })
  }
  if (init.method === 'PATCH') {
    if (failWrites(project, path)) return new Response('refused', { status: 500 })
    const fields = JSON.parse(init.body).fields
    docs.set(`${project}|${path}`, { ...(docs.get(`${project}|${path}`) || {}), ...fields })
    writes.push({ project, path, search, fields: decodeFields(fields) })
    return json({})
  }
  throw new Error(`unhandled ${init.method} ${url}`)
}

beforeEach(() => {
  docs = new Map(); writes = []; kv.clear()
  failWrites = () => false
})

// ---------- helpers ----------

const call = (path, { method = 'POST', auth = `Bearer ${SECRET}`, body } = {}) =>
  worker.fetch(new Request(`https://worker.test${path}`, {
    method,
    headers: { ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }), env())

const cutoffsWrites = () => writes.filter(w => w.project === DTR && w.path.startsWith('cutoffs/'))

// ---------- secretsMatch ----------

describe('secretsMatch', () => {
  test('matches equal secrets and rejects everything else', async () => {
    assert.equal(await secretsMatch('abc', 'abc'), true)
    assert.equal(await secretsMatch('abc', 'abd'), false)
    assert.equal(await secretsMatch('abc', 'abcd'), false)
    assert.equal(await secretsMatch('', ''), false, 'an unset secret never matches an empty bearer')
    assert.equal(await secretsMatch('abc', undefined), false)
    assert.equal(await secretsMatch(undefined, undefined), false)
  })
})

// ---------- /dtr/deadline ----------

describe('POST /dtr/deadline', () => {
  beforeEach(() => seed(DTR, 'cutoffs/c1', { startDate: new Date('2026-09-11T00:00:00Z'), endDate: new Date('2026-09-26T00:00:00Z') }))

  test('refuses a cutoffId that would steer the Firestore path', async () => {
    for (const bad of ['../users/victim', 'c1#', 'c1?x=1', 'c1/../users/x', 'a b', '']) {
      const res = await call(`/dtr/deadline?cutoffId=${encodeURIComponent(bad)}&submitBy=2026-09-28T02:00:00.000Z`)
      assert.equal(res.status, 400, `cutoffId ${JSON.stringify(bad)}`)
    }
    assert.equal(writes.length, 0, 'nothing was written anywhere')
  })

  test('refuses a submitBy with no zone, or no date at all', async () => {
    for (const bad of ['5', '1', '2026-09-28T10:00', '2026-09-28', 'tomorrow']) {
      const res = await call(`/dtr/deadline?cutoffId=c1&submitBy=${encodeURIComponent(bad)}`)
      assert.equal(res.status, 400, `submitBy ${JSON.stringify(bad)}`)
    }
    assert.equal(writes.length, 0)
  })

  test('sets the deadline as a one-field merge and reads it back', async () => {
    const res = await call('/dtr/deadline?cutoffId=c1&submitBy=2026-09-28T02:00:00.000Z')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.stored, true)
    assert.equal(cutoffsWrites().length, 1)
    assert.equal(cutoffsWrites()[0].path, 'cutoffs/c1')
    assert.equal(cutoffsWrites()[0].search, '?updateMask.fieldPaths=submitBy', 'a merge, never a replace')
  })

  test('is not reachable with the wrong secret or none', async () => {
    assert.equal((await call('/dtr/deadline?cutoffId=c1&submitBy=2026-09-28T02:00:00.000Z', { auth: 'Bearer wrong-secret' })).status, 401)
    assert.equal((await call('/dtr/deadline?cutoffId=c1&submitBy=2026-09-28T02:00:00.000Z', { auth: null })).status, 401)
    assert.equal(writes.length, 0)
  })
})

// ---------- /dtr/remind ----------

describe('POST /dtr/remind', () => {
  beforeEach(() => {
    seed(DTR, 'cutoffs/c1', {
      startDate: new Date('2026-09-11T00:00:00Z'), endDate: new Date('2026-09-26T00:00:00Z'),
      submitBy: new Date('2026-09-28T02:00:00Z'), createdAt: new Date('2026-09-10T00:00:00Z'),
    })
    seed(MSG, 'users/dtr-bot-uid-1', { name: 'DTR', type: 'bot' })
    seed(MSG, 'users/user-aaaa', { name: 'Ana', email: 'ana@punx.ai' })
    seed(MSG, 'users/user-bbbb', { name: 'Ben', email: 'ben@punx.ai' })
  })

  test('refuses an unknown kind, which has no sent-marker to guard it', async () => {
    for (const kind of ['foo', 'Cutoff', 'undefined', 'deadline,cutoff']) {
      const res = await call(`/dtr/remind?force=1&dry=1&kind=${encodeURIComponent(kind)}`)
      assert.equal(res.status, 400, kind)
    }
    assert.equal(writes.length, 0)
  })

  test('accepts the two real kinds', async () => {
    for (const kind of ['cutoff', 'deadline']) {
      const res = await call(`/dtr/remind?force=1&dry=1&kind=${kind}`)
      assert.equal(res.status, 200, kind)
      assert.equal((await res.json()).kind, kind)
    }
  })

  test('marks the cutoff only once EVERYONE has been told', async () => {
    const res = await call('/dtr/remind?force=1&kind=cutoff')
    const out = await res.json()
    assert.equal(out.sent, 2)
    assert.deepEqual(out.failed, [])
    assert.equal(out.markedSent, true)
    assert.equal(cutoffsWrites().length, 1)
    assert.equal(cutoffsWrites()[0].fields.reminderSentFor, 'c1')
  })

  test('a partly failed send is NOT marked complete, and says who failed', async () => {
    failWrites = (project, path) => project === MSG && path.includes('user-bbbb')
    const res = await call('/dtr/remind?force=1&kind=cutoff')
    const out = await res.json()
    assert.equal(out.sent, 1)
    assert.equal(out.failed.length, 1)
    assert.equal(out.failed[0].uid, 'user-bbbb')
    assert.equal(out.markedSent, false, 'the report no longer claims a marker that was never written')
    assert.equal(cutoffsWrites().length, 0, 'unmarked, so the run reads as incomplete rather than final')
  })

  test('reports a marker write that was refused instead of claiming it', async () => {
    failWrites = (project, path) => project === DTR && path.startsWith('cutoffs/')
    const out = await (await call('/dtr/remind?force=1&kind=cutoff')).json()
    assert.equal(out.sent, 2)
    assert.equal(out.markedSent, false)
  })

  test('a single-recipient test never marks the cutoff', async () => {
    const out = await (await call('/dtr/remind?force=1&kind=cutoff&only=ana@punx.ai')).json()
    assert.equal(out.sent, 1)
    assert.equal(cutoffsWrites().length, 0)
  })
})

// ---------- ID tokens ----------

describe('verifyAuth', () => {
  test('junk that merely has three dots is a 401, not a 500', async () => {
    for (const token of ['aaa.bbb.ccc', '!!!.@@@.###', 'e30.e30.sig', '..']) {
      const res = await call('/turn/credentials', { method: 'GET', auth: `Bearer ${token}` })
      assert.equal(res.status, 401, token)
    }
  })
})

// ---------- bot tokens ----------

describe('POST /bot/token', () => {
  const uid = 'botuid-12345678'
  const apiKey = `punxbot_${uid}_${'ab'.repeat(16)}`
  const hash = createHash('sha256').update(apiKey).digest('hex')
  const wrongKey = `punxbot_${uid}_${'cd'.repeat(16)}`
  const post = (key) => call('/bot/token', { auth: null, body: { apiKey: key } })

  beforeEach(() => {
    seed(MSG, `bots/${uid}`, { name: 'Disabled Bot', enabled: false })
    seed(MSG, `bots/${uid}/private/credentials`, { keyHash: hash })
  })

  test('a wrong key is a 401 whether or not the bot is disabled', async () => {
    assert.equal((await post(wrongKey)).status, 401)
    // And indistinguishable from a bot that does not exist at all.
    assert.equal((await post(`punxbot_nosuchbot-1234_${'ab'.repeat(16)}`)).status, 401)
  })

  test('only the right key learns the bot is disabled', async () => {
    const res = await post(apiKey)
    assert.equal(res.status, 403)
    assert.match((await res.json()).error, /disabled/)
  })
})

// ---------- path encoding ----------

describe('Firestore path handling', () => {
  test('refuses dot and empty segments rather than letting a URL parser collapse them', async () => {
    const sa = loadServiceAccount(env())
    for (const p of ['cutoffs/../users/x', 'a/./b', 'a//b', '../x']) {
      await assert.rejects(firestoreGet(env(), sa, p, DTR), (e) => e.status === 400, p)
    }
  })

  test('a literal %2E%2E is just an id once encoded, so it cannot become a dot segment', async () => {
    const sa = loadServiceAccount(env())
    seed(DTR, 'cutoffs/%2E%2E', { marker: 'inert' })
    // Encoded again on the way out ("%252E%252E"), so the server sees one odd id.
    assert.equal((await firestoreGet(env(), sa, 'cutoffs/%2E%2E', DTR)).marker, 'inert')
  })

  test('ordinary ids, including the `__` DM convo form, pass through unchanged', async () => {
    const sa = loadServiceAccount(env())
    seed(MSG, 'dms/aaa__bbb', { members: ['aaa', 'bbb'] })
    const got = await firestoreGet(env(), sa, 'dms/aaa__bbb')
    assert.deepEqual(got.members, ['aaa', 'bbb'])
  })
})
