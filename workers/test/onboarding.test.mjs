// Run with: npm test   (from workers/)
//
// New accounts joining the default group (POST /onboarding/join-default-group): who
// is added, who is not, which group, and that the write is atomic and touches nothing
// else. Tokens are really RS256-signed (the fake Google key endpoint serves the key),
// so verifyAuth runs its production path; the Firestore double understands :commit.

import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, test } from 'node:test'

import { encodeFields } from '../src/googleAuth.js'
import worker from '../src/index.js'
import { BACKFILL_ROLES, NEW_ACCOUNT_DAYS, STAFF_ROLES, classifyMembers, hasCompanyEmail, isNewAccount } from '../src/routes/onboarding.js'

// ---------- fixtures ----------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const SA = JSON.stringify({ client_email: 'sa@test.iam', private_key: PRIVATE_PEM })
const MSG = 'punx-test'
const DAY = 24 * 60 * 60 * 1000

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function token({ uid = 'new1', email = 'new@punx.ai', project = MSG } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = b64({ iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, email, iat: now - 5, exp: now + 3600 })
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')
  return `${head}.${body}.${sig}`
}

const kv = new Map()
const env = (over = {}) => ({
  FIREBASE_PROJECT_ID: MSG,
  FIREBASE_SERVICE_ACCOUNT: SA,
  ALLOWED_EMAIL_DOMAIN: 'punx.ai',
  ALLOWED_ORIGINS: 'https://plexus.punxai.online',
  DEFAULT_GROUP_NAME: 'PUNX TEAM',
  JWKS_CACHE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v) } },
  ...over,
})

// ---------- an in-memory Firestore that understands :commit ----------

let docs      // path -> REST fields
let commits   // every commit's writes, as sent
let failCommit
let failOnCommit // fail the Nth commit (1-based) only, to stop a job part-way
let beforeCommit // a hook run as a commit arrives, to change the world under it

const seed = (path, obj) => { docs.set(path, encodeFields(obj)) }
// Enough of a decoder for what these documents hold: text, booleans, timestamps, lists.
const decode = (v) => ('arrayValue' in v ? (v.arrayValue.values || []).map(decode)
  : 'stringValue' in v ? v.stringValue
  : 'timestampValue' in v ? v.timestampValue
  : 'booleanValue' in v ? v.booleanValue
  : null)
const read = (path) => (docs.has(path)
  ? Object.fromEntries(Object.entries(docs.get(path)).map(([k, v]) => [k, decode(v)]))
  : null)

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  if (url.startsWith('https://www.googleapis.com/robot/v1/metadata/jwk/')) return json({ keys: [JWK] })
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'sa-access', expires_in: 3600 })

  if (/\/documents:commit$/.test(url)) {
    const { writes } = JSON.parse(init.body)
    commits.push(writes)
    beforeCommit?.()
    if (failCommit || failOnCommit === commits.length) return json({ error: { message: 'secret detail from Google' } }, 500)
    // All or nothing: check every precondition first, then apply.
    const prefix = `projects/${MSG}/databases/(default)/documents/`
    for (const w of writes) {
      if (w.update && w.currentDocument?.exists && !docs.has(w.update.name.slice(prefix.length))) return json({ error: 'NOT_FOUND' }, 404)
    }
    for (const w of writes) {
      if (w.transform) {
        const path = w.transform.document.slice(prefix.length)
        const cur = read(path) ?? {}
        for (const t of w.transform.fieldTransforms) {
          const have = Array.isArray(cur[t.fieldPath]) ? cur[t.fieldPath] : []
          const add = t.appendMissingElements.values.map((v) => v.stringValue)
          cur[t.fieldPath] = [...have, ...add.filter((x) => !have.includes(x))]
        }
        seed(path, cur)
      } else if (w.update) {
        const path = w.update.name.slice(prefix.length)
        const cur = docs.get(path) ?? {}
        for (const f of w.updateMask.fieldPaths) cur[f] = w.update.fields[f]
        docs.set(path, cur)
      }
    }
    return json({ writeResults: writes.map(() => ({})) })
  }

  const q = /\/projects\/([^/]+)\/databases\/\(default\)\/documents:runQuery$/.exec(url)
  if (q) {
    const sq = JSON.parse(init.body).structuredQuery
    const collection = sq.from[0].collectionId
    const rows = [...docs.entries()]
      .filter(([k]) => k.startsWith(`${collection}/`) && k.split('/').length === 2)
      .slice(0, sq.limit ?? Infinity) // as Firestore does: at most `limit` documents come back
      .map(([k, fields]) => ({ document: { name: `x/${k.split('/').pop()}`, fields } }))
    return json(rows.length ? rows : [{}])
  }

  const m = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/([^/]+)\/databases\/\(default\)\/documents\/(.*)$/.exec(url)
  if (m) {
    const path = decodeURIComponent(m[2])
    return docs.has(path) ? json({ fields: docs.get(path) }) : new Response('{}', { status: 404 })
  }
  throw new Error(`unexpected fetch in test: ${init.method || 'GET'} ${url}`)
}

const call = (over = {}, { auth = `Bearer ${token()}`, method = 'POST' } = {}) =>
  worker.fetch(new Request('https://worker.test/onboarding/join-default-group', {
    method,
    headers: auth ? { Authorization: auth, Origin: 'https://plexus.punxai.online' } : {},
  }), env(over))

const body = async (res) => res.json()
const members = (id = 'g1') => read(`groups/${id}`).memberUids
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()

beforeEach(() => {
  docs = new Map(); commits = []; failCommit = false; failOnCommit = null; beforeCommit = null; kv.clear()
  seed('users/boss', { name: 'Boss', role: 'super_admin' })
  seed('groups/g1', { name: 'PUNX TEAM', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss', 'ana'] })
  seed('users/new1', { name: 'New', email: 'new@punx.ai', role: 'employee', createdAt: iso(60_000) })
})

// ---------- the rule for "new" ----------

describe('isNewAccount', () => {
  test('is true for an account made in the last week, and false before or without a date', () => {
    const now = Date.parse('2026-11-13T12:00:00Z')
    assert.equal(NEW_ACCOUNT_DAYS, 7)
    assert.equal(isNewAccount('2026-11-13T11:59:00Z', now), true, 'a minute ago')
    assert.equal(isNewAccount('2026-11-06T12:00:01Z', now), true, 'just inside 7 days')
    assert.equal(isNewAccount('2026-11-06T11:59:59Z', now), false, 'just outside 7 days')
    for (const bad of [undefined, null, '', 'yesterday', {}, 12345]) assert.equal(isNewAccount(bad, now), false, String(bad))
  })

  test('a date in the far future is not "new" (a forged profile cannot stay new forever)', () => {
    const now = Date.parse('2026-11-13T12:00:00Z')
    assert.equal(isNewAccount('2026-11-13T12:03:00Z', now), true, 'a little clock skew is allowed')
    assert.equal(isNewAccount('2027-01-01T00:00:00Z', now), false)
  })
})

// ---------- the company address ----------

describe('hasCompanyEmail', () => {
  test('is exactly name@punx.ai, in any letter case', () => {
    assert.equal(hasCompanyEmail('ana@punx.ai', {}), true)
    assert.equal(hasCompanyEmail('Ana.Reyes@PUNX.AI', {}), true)
    assert.equal(hasCompanyEmail('ana@punx.ai', { ALLOWED_EMAIL_DOMAIN: 'punx.ai' }), true)
  })

  test('is not a longer domain that merely ends the same way, or one that contains it', () => {
    for (const e of ['ana@notpunx.ai', 'ana@sub.punx.ai', 'ana@punx.ai.evil.com', 'ana@punx.ai.', 'ana@xpunx.ai', 'ana@punx.air']) {
      assert.equal(hasCompanyEmail(e, {}), false, e)
    }
  })

  test('is not an address with no name, no domain, or no @', () => {
    for (const e of ['@punx.ai', 'punx.ai', 'ana@', '', '   ', null, undefined, 42, {}]) assert.equal(hasCompanyEmail(e, {}), false, String(e))
  })

  test('follows the configured domain, and defaults to punx.ai when none is set', () => {
    assert.equal(hasCompanyEmail('ana@example.org', { ALLOWED_EMAIL_DOMAIN: 'example.org' }), true)
    assert.equal(hasCompanyEmail('ana@punx.ai', { ALLOWED_EMAIL_DOMAIN: 'example.org' }), false)
    assert.equal(hasCompanyEmail('ana@punx.ai', { ALLOWED_EMAIL_DOMAIN: '' }), true)
    assert.equal(hasCompanyEmail('ana@example.org', { ALLOWED_EMAIL_DOMAIN: ' Example.ORG ' }), true, 'trimmed, any case')
  })
})

// ---------- who is added ----------

describe('a new account', () => {
  test('is added to the default group and marked, in one commit', async () => {
    const res = await call()
    assert.equal(res.status, 200)
    assert.deepEqual(await body(res), { joined: true, groupId: 'g1' })
    assert.deepEqual(members(), ['boss', 'ana', 'new1'], 'appended, the others kept in order')
    assert.ok(read('users/new1').defaultGroupJoinedAt, 'profile marked')
    assert.equal(commits.length, 1, 'one commit')
    assert.equal(commits[0].length, 2, 'the group and the profile together')
  })

  test('touches nothing else on the group, and nothing else on the profile', async () => {
    const before = { group: read('groups/g1'), user: read('users/new1') }
    await call()
    const group = read('groups/g1'), user = read('users/new1')
    assert.deepEqual({ ...group, memberUids: undefined }, { ...before.group, memberUids: undefined })
    assert.deepEqual({ ...user, defaultGroupJoinedAt: undefined }, { ...before.user, defaultGroupJoinedAt: undefined })
    assert.equal(commits[0][0].transform.fieldTransforms.length, 1)
    assert.equal(commits[0][0].transform.fieldTransforms[0].fieldPath, 'memberUids')
    assert.deepEqual(commits[0][1].updateMask.fieldPaths, ['defaultGroupJoinedAt'])
  })

  test('adds only the caller, from the verified token', async () => {
    seed('users/other', { name: 'Other', role: 'employee', createdAt: iso(1000) })
    await call({}, { auth: `Bearer ${token({ uid: 'other', email: 'other@punx.ai' })}` })
    assert.deepEqual(members(), ['boss', 'ana', 'other'])
    assert.equal(read('users/new1').defaultGroupJoinedAt, undefined, 'someone else\'s profile is not marked')
    assert.deepEqual(commits[0][0].transform.fieldTransforms[0].appendMissingElements.values, [{ stringValue: 'other' }])
  })

  test('already in the group by another route is not listed twice, and is still marked', async () => {
    seed('groups/g1', { name: 'PUNX TEAM', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss', 'new1'] })
    assert.equal((await body(await call())).joined, true)
    assert.deepEqual(members(), ['boss', 'new1'])
    assert.ok(read('users/new1').defaultGroupJoinedAt)
  })

  test('every staff role is added, and nothing else is', async () => {
    for (const role of STAFF_ROLES) {
      seed('users/new1', { name: 'New', role, createdAt: iso(1000) })
      assert.equal((await body(await call())).joined, true, role)
      seed('groups/g1', { name: 'PUNX TEAM', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss'] })
    }
    assert.deepEqual([...STAFF_ROLES].sort(), ['admin', 'developer', 'employee', 'super_admin'])
  })
})

describe('who is not added', () => {
  const refused = async (reason, over) => {
    const res = await call(over)
    assert.equal(res.status, 200)
    assert.deepEqual(await body(res), { joined: false, reason })
    assert.equal(commits.length, 0, 'no commit')
    assert.deepEqual(members(), ['boss', 'ana'], 'the group is unchanged')
  }

  test('an externally allowed address is signed in as staff but is not added', async () => {
    seed('users/ext', { name: 'Ext', email: 'ext@gmail.com', role: 'employee', createdAt: iso(1000) })
    const over = { ALLOWED_EXTRA_EMAILS: 'ext@gmail.com' }
    const res = await call(over, { auth: `Bearer ${token({ uid: 'ext', email: 'ext@gmail.com' })}` })
    assert.equal(res.status, 200)
    assert.deepEqual(await body(res), { joined: false, reason: 'not-company-email' })
    assert.equal(commits.length, 0)
    assert.deepEqual(members(), ['boss', 'ana'])
    assert.equal(read('users/ext').defaultGroupJoinedAt, undefined, 'and not marked either')
  })

  test('the email that counts is the one on the signed token, not the one on the profile', async () => {
    // A profile can say anything; the token is what Google vouches for.
    seed('users/ext', { name: 'Ext', email: 'someone@punx.ai', role: 'employee', createdAt: iso(1000) })
    const over = { ALLOWED_EXTRA_EMAILS: 'ext@gmail.com' }
    const res = await call(over, { auth: `Bearer ${token({ uid: 'ext', email: 'ext@gmail.com' })}` })
    assert.deepEqual(await body(res), { joined: false, reason: 'not-company-email' })
    assert.equal(commits.length, 0)
  })

  test('a sign-in with a look-alike domain never reaches the route (the Worker refuses it)', async () => {
    const res = await call({}, { auth: `Bearer ${token({ email: 'new@punx.ai.evil.com' })}` })
    assert.equal(res.status, 403)
    assert.equal(commits.length, 0)
  })

  test('someone who is already marked (joined, or left since) is not put back', () => {
    seed('users/new1', { name: 'New', role: 'employee', createdAt: iso(1000), defaultGroupJoinedAt: iso(500) })
    return refused('already')
  })

  test('an account older than a week is left alone', () => {
    seed('users/new1', { name: 'New', role: 'employee', createdAt: iso(8 * DAY) })
    return refused('not-new')
  })

  test('a profile with no creation date is not treated as new', () => {
    seed('users/new1', { name: 'New', role: 'employee' })
    return refused('not-new')
  })

  test('a guest is not added (guests see single channels only)', () => {
    seed('users/new1', { name: 'New', role: 'guest', createdAt: iso(1000) })
    return refused('not-staff')
  })

  test('an unknown or missing role is not added', async () => {
    seed('users/new1', { name: 'New', role: 'overlord', createdAt: iso(1000) })
    await refused('not-staff')
    seed('users/new1', { name: 'New', createdAt: iso(1000) })
    await refused('not-staff')
  })

  test('a removed account is not added', () => {
    seed('users/new1', { name: 'New', role: 'employee', createdAt: iso(1000), deactivated: true })
    return refused('removed')
  })

  test('someone with no profile yet is not added', () => {
    docs.delete('users/new1')
    return refused('no-profile')
  })
})

// ---------- who may ask ----------

describe('asking', () => {
  test('needs a signed-in messenger user', async () => {
    assert.equal((await call({}, { auth: null })).status, 401)
    assert.equal((await call({}, { auth: 'Bearer not.a.token' })).status, 401)
    assert.equal((await call({}, { auth: `Bearer ${token({ project: 'punx-dtr' })}` })).status, 401, 'another project\'s token')
    assert.equal(commits.length, 0)
  })

  test('only POST is served', async () => {
    const res = await call({}, { method: 'GET' })
    assert.notEqual(res.status, 200)
    assert.equal(commits.length, 0)
  })

  test('carries CORS for the app', async () => {
    const res = await call()
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://plexus.punxai.online')
  })
})

// ---------- which group ----------

describe('which group', () => {
  test('is found by name, ignoring case and spaces around it', async () => {
    seed('groups/g1', { name: '  Punx Team ', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss'] })
    assert.equal((await body(await call())).groupId, 'g1')
  })

  test('other groups are left alone, including one with a similar name', async () => {
    seed('groups/g2', { name: 'PUNX TEAM 2', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss'] })
    seed('groups/g3', { name: 'Creatives', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss'] })
    await call()
    assert.deepEqual(members('g2'), ['boss'])
    assert.deepEqual(members('g3'), ['boss'])
    assert.deepEqual(members('g1'), ['boss', 'ana', 'new1'])
  })

  test('two groups with the name means none is joined', async () => {
    seed('groups/g2', { name: 'punx team', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss'] })
    const res = await body(await call())
    assert.deepEqual(res, { joined: false, reason: 'no-default-group' })
    assert.equal(commits.length, 0)
    assert.equal(read('users/new1').defaultGroupJoinedAt, undefined, 'not marked, so a later attempt can still succeed')
  })

  test('a group made by an ordinary member under that name is never the default', async () => {
    seed('users/emp', { name: 'Emp', role: 'employee' })
    seed('groups/g1', { name: 'PUNX TEAM', ownerUid: 'emp', adminUids: ['emp'], memberUids: ['emp'] })
    assert.deepEqual(await body(await call()), { joined: false, reason: 'no-default-group' })
    assert.equal(commits.length, 0)
  })

  test('a group with no owner on record is not trusted', async () => {
    seed('groups/g1', { name: 'PUNX TEAM', adminUids: [], memberUids: [] })
    assert.deepEqual(await body(await call()), { joined: false, reason: 'no-default-group' })
  })

  test('a configured id wins over the name, and is trusted as configured', async () => {
    seed('groups/g9', { name: 'Something else', ownerUid: 'emp', adminUids: [], memberUids: ['emp'] })
    assert.deepEqual(await body(await call({ DEFAULT_GROUP_ID: 'g9' })), { joined: true, groupId: 'g9' })
    assert.deepEqual(members('g9'), ['emp', 'new1'])
    assert.deepEqual(members('g1'), ['boss', 'ana'], 'the named group is untouched')
  })

  test('a configured id that does not exist joins nothing', async () => {
    assert.deepEqual(await body(await call({ DEFAULT_GROUP_ID: 'missing' })), { joined: false, reason: 'no-default-group' })
    assert.equal(commits.length, 0)
  })

  test('with nothing configured nothing is joined', async () => {
    assert.deepEqual(await body(await call({ DEFAULT_GROUP_NAME: '' })), { joined: false, reason: 'no-default-group' })
    assert.deepEqual(await body(await call({ DEFAULT_GROUP_NAME: undefined })), { joined: false, reason: 'no-default-group' })
    assert.equal(commits.length, 0)
  })
})

// ---------- failure ----------

describe('when the write fails', () => {
  test('nothing is half done, the answer is an error, and Google\'s own words are not passed on', async () => {
    failCommit = true
    const res = await call()
    assert.equal(res.status, 502)
    assert.ok(!JSON.stringify(await body(res)).includes('secret detail'))
    assert.deepEqual(members(), ['boss', 'ana'])
    assert.equal(read('users/new1').defaultGroupJoinedAt, undefined, 'not marked, so the next sign-in tries again')
  })

  test('a second attempt after a failure succeeds', async () => {
    failCommit = true
    await call()
    failCommit = false
    assert.equal((await body(await call())).joined, true)
    assert.deepEqual(members(), ['boss', 'ana', 'new1'])
  })

  test('calling again after success changes nothing', async () => {
    await call()
    const again = await body(await call())
    assert.deepEqual(again, { joined: false, reason: 'already' })
    assert.equal(commits.length, 1)
  })

  test('a profile removed between the check and the write fails the whole commit and adds nobody', async () => {
    // The precondition on the profile (exists: true) is what makes the pair all-or-nothing.
    beforeCommit = () => docs.delete('users/new1')
    const res = await call()
    assert.equal(res.status, 502, 'the commit was refused')
    assert.deepEqual(members(), ['boss', 'ana'], 'the group was not changed either')
  })
})

// ---------- the one-off job: everyone already here ----------

describe('adding the existing members', () => {
  const run = ({ dry = false, uid = 'boss', email = 'boss@punx.ai', method = 'POST', auth, over } = {}) =>
    worker.fetch(new Request(`https://worker.test/onboarding/add-existing-members${dry ? '?dry=1' : ''}`, {
      method,
      headers: (auth ?? `Bearer ${token({ uid, email })}`) ? { Authorization: auth ?? `Bearer ${token({ uid, email })}`, Origin: 'https://plexus.punxai.online' } : {},
    }), env(over))

  const person = (name, email, role = 'employee', extra = {}) => ({ name, email, role, createdAt: iso(90 * DAY), ...extra })

  beforeEach(() => {
    seed('users/boss', person('Boss', 'boss@punx.ai', 'super_admin'))
    seed('users/ana', person('Ana', 'ana@punx.ai'))                       // already in the group
    seed('users/ben', person('Ben', 'ben@punx.ai'))
    seed('users/cara', person('Cara', 'cara@punx.ai', 'admin'))
    seed('users/dev1', person('Dev One', 'dev@punx.ai', 'developer'))
    seed('users/sup', person('Sup', 'sup@punx.ai', 'super_admin'))
    seed('users/guest1', person('Guest', 'guest@gmail.com', 'guest'))       // an outsider invited into one channel
    seed('users/guest2', person('Guest Two', 'guest2@punx.ai', 'guest'))     // a guest with a company address
    seed('users/bot1', { name: 'A bot', email: null, role: 'employee', type: 'bot' })
    seed('users/gone', person('Gone', 'gone@punx.ai', 'employee', { deactivated: true }))
    seed('users/ext', person('External', 'ext@gmail.com'))
    seed('users/marked', person('Marked', 'marked@punx.ai', 'employee', { defaultGroupJoinedAt: iso(5 * DAY) }))
    seed('users/odd', person('Odd', 'odd@punx.ai', 'overlord'))
    // new1 (from the outer beforeEach) is a recent employee not in the group: it qualifies too.
  })

  const stamped = (uid) => !!read(`users/${uid}`)?.defaultGroupJoinedAt

  describe('who may run it', () => {
    test('a developer or a super admin', async () => {
      assert.equal((await run({ dry: true })).status, 200)
      seed('users/dev1', person('Dev One', 'dev@punx.ai', 'developer'))
      assert.equal((await run({ dry: true, uid: 'dev1', email: 'dev@punx.ai' })).status, 200)
    })

    test('nobody else: an admin, an employee, a guest, a removed account, or a stranger', async () => {
      seed('users/boss2', person('Boss Two', 'boss2@punx.ai', 'super_admin', { deactivated: true }))
      for (const [uid, email] of [['cara', 'cara@punx.ai'], ['ben', 'ben@punx.ai'], ['guest1', 'guest@gmail.com'], ['boss2', 'boss2@punx.ai'], ['nobody', 'nobody@punx.ai']]) {
        const res = await run({ uid, email })
        assert.equal(res.status, 403, uid)
      }
      assert.equal(commits.length, 0)
      assert.deepEqual(members(), ['boss', 'ana'])
    })

    test('and only from a company address, even for a super admin', async () => {
      seed('users/boss', person('Boss', 'boss@gmail.com', 'super_admin'))
      const res = await run({ email: 'boss@gmail.com', over: { ALLOWED_EXTRA_EMAILS: 'boss@gmail.com' } })
      assert.equal(res.status, 403)
      assert.equal(commits.length, 0)
    })

    test('needs a signed-in messenger user, and only POST is served', async () => {
      assert.equal((await run({ auth: '' })).status, 401)
      assert.equal((await run({ auth: 'Bearer not.a.token' })).status, 401)
      assert.equal((await run({ method: 'GET' })).status, 404)
      assert.equal(commits.length, 0)
    })

    test('the role is read from the profile at the time of asking, not from the token', async () => {
      assert.equal((await run({ dry: true })).status, 200)
      seed('users/boss', person('Boss', 'boss@punx.ai', 'employee')) // demoted between two requests
      assert.equal((await run({ dry: true })).status, 403)
    })
  })

  describe('the preview (?dry=1)', () => {
    test('says what would happen and writes nothing', async () => {
      const res = await run({ dry: true })
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.dryRun, true)
      assert.equal(body.groupId, 'g1')
      assert.equal(body.groupName, 'PUNX TEAM')
      assert.equal(body.eligible, 7, 'boss, ana, ben, cara, dev1, sup and new1')
      assert.equal(body.toAdd, 5, 'ben, cara, dev1, sup, new1')
      assert.equal(body.alreadyIn, 2, 'boss and ana')
      assert.deepEqual(body.skipped, { bots: 1, removed: 1, external: 2, guests: 1, otherRoles: 1, alreadyStamped: 1 })
      assert.deepEqual([...body.names].sort(), ['Ben', 'Cara', 'Dev One', 'New', 'Sup'])
      assert.equal(commits.length, 0, 'no write')
      assert.deepEqual(members(), ['boss', 'ana'])
      assert.equal(stamped('ben'), false)
    })

    test('names the people, never their addresses or ids', async () => {
      const text = JSON.stringify(await (await run({ dry: true })).json())
      for (const secret of ['ben@punx.ai', 'cara@punx.ai', 'guest@gmail.com', 'guest2@punx.ai', 'dev1', 'bot1']) assert.ok(!text.includes(secret), secret)
    })

    test('shows at most 200 names however many there are', async () => {
      for (let i = 0; i < 250; i++) seed(`users/p${i}`, person(`P${i}`, `p${i}@punx.ai`))
      const body = await (await run({ dry: true })).json()
      assert.equal(body.toAdd, 255)
      assert.equal(body.names.length, 200)
    })
  })

  describe('doing it', () => {
    test('adds every qualifying account that is not in yet, and leaves the members as they were', async () => {
      const res = await run()
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.dryRun, false)
      assert.equal(body.added, 5)
      assert.equal(body.stamped, 7)
      assert.deepEqual(members().slice(0, 2), ['boss', 'ana'], 'those already in keep their place')
      assert.deepEqual([...members()].sort(), ['ana', 'ben', 'boss', 'cara', 'dev1', 'new1', 'sup'])
    })

    test('stamps everyone who qualified, in the group already or not', async () => {
      await run()
      for (const uid of ['boss', 'ana', 'ben', 'cara', 'dev1', 'sup', 'new1']) assert.equal(stamped(uid), true, uid)
    })

    test('never adds or stamps a guest, a bot, a removed account, an outside address, an unknown role, or someone already stamped', async () => {
      const before = Object.fromEntries(['guest1', 'guest2', 'bot1', 'gone', 'ext', 'odd', 'marked'].map((u) => [u, JSON.stringify(read(`users/${u}`))]))
      await run()
      for (const uid of Object.keys(before)) {
        assert.ok(!members().includes(uid), `${uid} not added`)
        assert.equal(JSON.stringify(read(`users/${uid}`)), before[uid], `${uid} not touched`)
      }
    })

    test('touches only the member list on the group and only the stamp on each profile', async () => {
      const group = read('groups/g1')
      const ben = read('users/ben')
      await run()
      assert.deepEqual({ ...read('groups/g1'), memberUids: undefined }, { ...group, memberUids: undefined })
      assert.deepEqual({ ...read('users/ben'), defaultGroupJoinedAt: undefined }, { ...ben, defaultGroupJoinedAt: undefined })
      const writes = commits.flat()
      // Only people who actually need adding are sent: not those already in, not anyone left out.
      const appended = writes.filter((w) => w.transform)
        .flatMap((w) => w.transform.fieldTransforms[0].appendMissingElements.values.map((v) => v.stringValue))
      assert.deepEqual([...appended].sort(), ['ben', 'cara', 'dev1', 'new1', 'sup'])
      assert.ok(writes.filter((w) => w.transform).every((w) => w.transform.fieldTransforms.length === 1 && w.transform.fieldTransforms[0].fieldPath === 'memberUids'))
      assert.ok(writes.filter((w) => w.update).every((w) => w.updateMask.fieldPaths.length === 1 && w.updateMask.fieldPaths[0] === 'defaultGroupJoinedAt' && w.currentDocument.exists === true))
    })

    test('running it again changes nothing', async () => {
      await run()
      const done = commits.length
      const again = await (await run()).json()
      assert.equal(again.added, 0)
      assert.equal(again.stamped, 0)
      assert.equal(commits.length, done, 'no further write')
    })

    test('a person who left the group since is not put back by a second run', async () => {
      await run()
      seed('groups/g1', { name: 'PUNX TEAM', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss', 'ana'] }) // ben, cara... all left
      const again = await (await run()).json()
      assert.equal(again.added, 0)
      assert.deepEqual(members(), ['boss', 'ana'])
    })

    test('the caller need not be in the group', async () => {
      seed('groups/g1', { name: 'PUNX TEAM', ownerUid: 'cara', adminUids: ['cara'], memberUids: ['cara'] })
      seed('users/cara', person('Cara', 'cara@punx.ai', 'developer'))
      const res = await run()
      assert.equal(res.status, 200)
      assert.ok(members().includes('boss'))
    })
  })

  describe('which group, and how much', () => {
    test('with no single trusted default group it does nothing and says so', async () => {
      seed('groups/g2', { name: 'punx team', ownerUid: 'boss', adminUids: ['boss'], memberUids: ['boss'] })
      const res = await run()
      assert.equal(res.status, 409)
      assert.match((await res.json()).error, /default group/)
      assert.equal(commits.length, 0)
    })

    test('a very large workspace is split into commits of a safe size', async () => {
      for (let i = 0; i < 450; i++) seed(`users/q${i}`, person(`Q${i}`, `q${i}@punx.ai`))
      const body = await (await run()).json()
      assert.equal(body.added, 455)
      const adds = commits.filter((c) => c[0].transform)
      const stamps = commits.filter((c) => c[0].update)
      assert.ok(adds.length >= 2)
      assert.ok(adds.every((c) => c.length === 1 && c[0].transform.fieldTransforms[0].appendMissingElements.values.length <= 400))
      assert.ok(stamps.length >= 3)
      assert.ok(stamps.every((c) => c.length <= 200))
      assert.equal(members().length, 2 + 455)
      assert.equal(stamped('q449'), true)
    })

    test('too many accounts to be sure of the whole list and it refuses rather than do part', async () => {
      for (let i = 0; i < 2000; i++) seed(`users/z${i}`, person(`Z${i}`, `z${i}@punx.ai`))
      const res = await run()
      assert.equal(res.status, 413)
      assert.equal(commits.length, 0)
    })
  })

  describe('when it stops part-way', () => {
    test('what was done stays done, the profile stamps are not half-applied, and running it again finishes', async () => {
      failOnCommit = 2 // the group commit (1) works; the first stamp commit (2) fails
      const res = await run()
      assert.equal(res.status, 502)
      assert.ok(!JSON.stringify(await res.json()).includes('secret detail'))
      assert.ok(members().includes('ben'), 'the group was updated')
      assert.equal(stamped('ben'), false, 'no profile stamped yet')

      failOnCommit = null
      const again = await (await run()).json()
      assert.equal(again.added, 0, 'those already added are not added twice')
      assert.equal(again.stamped, 7)
      assert.equal(stamped('ben'), true)
    })
  })
})
