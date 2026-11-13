// A new @punx.ai account joins the default group (PUNX TEAM): when the app asks, and
// that the app and the Worker agree. The Worker's own tests are workers/test/onboarding.test.mjs.
//
//   node --test tests/onboarding.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NEW_ACCOUNT_DAYS, STAFF_ROLES, hasCompanyEmail, shouldJoinDefaultGroup } from '../src/lib/onboarding.js'
import * as worker from '../workers/src/routes/onboarding.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-13T12:00:00Z')
const ts = (msAgo) => ({ toMillis: () => NOW - msAgo })
const base = { profile: { role: 'employee', createdAt: ts(60_000) }, email: 'ana@punx.ai', domain: 'punx.ai', now: NOW }
const ask = (over = {}) => shouldJoinDefaultGroup({ ...base, ...over })

test('a new company account asks', () => {
  assert.equal(ask(), true)
})

test('an account made just now asks even before its creation time has been resolved', () => {
  assert.equal(ask({ justCreated: true, profile: { role: 'employee', createdAt: null } }), true)
})

test('an account from the last week asks again at the next sign-in (a first attempt may have failed)', () => {
  assert.equal(ask({ profile: { role: 'employee', createdAt: ts(6 * DAY) } }), true)
})

test('an account older than a week does not ask: people who were here before are not touched', () => {
  assert.equal(ask({ profile: { role: 'employee', createdAt: ts(8 * DAY) } }), false)
  assert.equal(ask({ profile: { role: 'employee' } }), false, 'no creation date and not just created')
})

test('someone already marked does not ask, so a person who left is not put back', () => {
  assert.equal(ask({ profile: { role: 'employee', createdAt: ts(1000), defaultGroupJoinedAt: ts(500) } }), false)
  assert.equal(ask({ justCreated: true, profile: { role: 'employee', defaultGroupJoinedAt: ts(500) } }), false)
})

test('only company addresses ask: an externally allowed or look-alike address does not', () => {
  assert.equal(ask({ email: 'perezjohnrey43@gmail.com' }), false)
  assert.equal(ask({ email: 'ana@notpunx.ai' }), false)
  assert.equal(ask({ email: 'ana@sub.punx.ai' }), false)
  assert.equal(ask({ email: '' }), false)
  assert.equal(ask({ email: undefined }), false)
  assert.equal(ask({ justCreated: true, email: 'x@gmail.com' }), false, 'even a brand-new one')
})

test('guests and unknown roles do not ask', () => {
  assert.equal(ask({ profile: { role: 'guest', createdAt: ts(1000) } }), false)
  assert.equal(ask({ profile: { role: 'overlord', createdAt: ts(1000) } }), false)
  assert.equal(ask({ profile: { createdAt: ts(1000) } }), false)
})

test('every staff role asks', () => {
  for (const role of STAFF_ROLES) assert.equal(ask({ profile: { role, createdAt: ts(1000) } }), true, role)
})

test('no profile, or a creation date far in the future, never asks', () => {
  assert.equal(ask({ profile: null }), false)
  assert.equal(ask({ profile: undefined }), false)
  assert.equal(ask({ profile: { role: 'employee', createdAt: { toMillis: () => NOW + 365 * DAY } } }), false)
})

test('a creation time as a Date works, and anything else is not a date', () => {
  assert.equal(ask({ profile: { role: 'employee', createdAt: new Date(NOW - 1000) } }), true)
  for (const bad of ['yesterday', 12345, {}, []]) assert.equal(ask({ profile: { role: 'employee', createdAt: bad } }), false, String(bad))
})

test('the company address check is exact and follows the configured domain', () => {
  assert.equal(hasCompanyEmail('Ana@PUNX.AI', 'punx.ai'), true)
  assert.equal(hasCompanyEmail('ana@punx.ai', ' Punx.AI '), true)
  assert.equal(hasCompanyEmail('ana@punx.ai', ''), false, 'no domain configured: nobody qualifies')
  assert.equal(hasCompanyEmail('ana@punx.ai', undefined), false)
  assert.equal(hasCompanyEmail('ana@', ''), false, 'an empty domain must not match an address that ends at the @')
  assert.equal(hasCompanyEmail('ana@', undefined), false)
  assert.equal(hasCompanyEmail('@punx.ai', 'punx.ai'), false)
})

// ---------- the app and the Worker agree ----------

test('the app and the Worker share one definition of staff and of "new"', () => {
  assert.deepEqual([...STAFF_ROLES], [...worker.STAFF_ROLES])
  assert.equal(NEW_ACCOUNT_DAYS, worker.NEW_ACCOUNT_DAYS)
})

test('the app and the Worker agree on which addresses are the company\'s', () => {
  const emails = ['ana@punx.ai', 'Ana@PUNX.AI', 'a@notpunx.ai', 'a@sub.punx.ai', 'a@punx.ai.evil.com', '@punx.ai', 'punx.ai', '', null, undefined, 'x@gmail.com']
  for (const e of emails) assert.equal(hasCompanyEmail(e, 'punx.ai'), worker.hasCompanyEmail(e, { ALLOWED_EMAIL_DOMAIN: 'punx.ai' }), String(e))
})

test('the app and the Worker agree on how old is new', () => {
  const edge = (msAgo) => ({ profile: { role: 'employee', createdAt: ts(msAgo) } })
  for (const msAgo of [0, 6 * DAY, 7 * DAY, 7 * DAY + 1000, 30 * DAY]) {
    assert.equal(
      ask(edge(msAgo)),
      worker.isNewAccount(new Date(NOW - msAgo).toISOString(), NOW),
      `${msAgo / DAY} days`,
    )
  }
})

// ---------- the wiring ----------

test('signing in asks, without waiting and without it ever failing the sign-in', () => {
  const src = lf(fs.readFileSync('src/lib/auth.jsx', 'utf8'))
  assert.ok(src.includes("import { shouldJoinDefaultGroup } from './onboarding'"))
  assert.ok(src.includes("import { requestDefaultGroup } from './onboardingApi'"))
  assert.ok(
    src.includes('if (shouldJoinDefaultGroup({ profile: fresh.data(), email, domain: ALLOWED_DOMAIN, justCreated: !known })) {'),
    'asked once the profile is in, with the real address and the configured domain',
  )
  assert.ok(src.includes('requestDefaultGroup().catch('), 'a failure is swallowed and logged')
  assert.ok(!src.includes('await requestDefaultGroup('), 'sign-in does not wait for it')
  // After the profile is set, and before the catch that signs people out on a failure.
  assert.ok(src.indexOf('setProfile({ id: u.uid, ...fresh.data() })') < src.indexOf('requestDefaultGroup().catch('))
})

test('the request is a POST with the person\'s own ID token and no body', () => {
  const src = lf(fs.readFileSync('src/lib/onboardingApi.js', 'utf8'))
  assert.ok(src.includes('/onboarding/join-default-group'))
  assert.ok(src.includes("method: 'POST'"))
  assert.ok(src.includes('Authorization: `Bearer ${await user.getIdToken()}`'))
  assert.ok(!/body\s*:/.test(src), 'nothing the person could tamper with is sent')
})

test('the Worker serves the route for POST only, and takes nothing from the request body', () => {
  const index = lf(fs.readFileSync('workers/src/index.js', 'utf8'))
  assert.ok(index.includes("url.pathname === '/onboarding/join-default-group' && request.method === 'POST'"))
  const route = lf(fs.readFileSync('workers/src/routes/onboarding.js', 'utf8'))
  assert.ok(!/request\.(json|text|formData|arrayBuffer)\(/.test(route), 'who is added comes only from the verified token')
})

test('the default group is configured by name in wrangler.toml', () => {
  const toml = lf(fs.readFileSync('workers/wrangler.toml', 'utf8'))
  assert.ok(toml.includes('DEFAULT_GROUP_NAME = "PUNX TEAM"'))
  assert.ok(!/^DEFAULT_GROUP_ID\s*=/m.test(toml), 'no id pinned: the name is the setting')
})
