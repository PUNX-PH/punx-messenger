// Run with: npm test   (from workers/)
//
// The DTR company calendar for the messenger widget (GET /dtr/calendar): who may
// ask, what comes back (and what must not), and the month maths. The crypto is real:
// tokens are RS256-signed with a generated key that the fake Google key endpoint
// serves, so verifyAuth runs its production path.

import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, test } from 'node:test'

import { encodeFields } from '../src/googleAuth.js'
import worker from '../src/index.js'
import { holidaysForYears, parseYMD, toYMD } from '../src/lib/dtrHolidays.js'
import { calendarRoles, gridRange, parseMonth, shapeCalendar } from '../src/routes/dtrCalendar.js'

// ---------- fixtures ----------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const SA = JSON.stringify({ client_email: 'sa@test.iam', private_key: PRIVATE_PEM })
const MSG = 'punx-test'
const DTR = 'punx-dtr'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function token({ uid = 'u1', email = 'dev@punx.ai', project = MSG, expOffset = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = b64({ iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, email, iat: now - 5, exp: now + expOffset })
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')
  return `${head}.${body}.${sig}`
}

let kv
let kvPuts
const env = (over = {}) => ({
  FIREBASE_PROJECT_ID: MSG,
  DTR_PROJECT_ID: DTR,
  FIREBASE_SERVICE_ACCOUNT: SA,
  DTR_SERVICE_ACCOUNT: SA,
  ALLOWED_EMAIL_DOMAIN: 'punx.ai',
  ALLOWED_ORIGINS: 'https://plexus.punxai.online',
  JWKS_CACHE: {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v, opts) => { kv.set(k, v); kvPuts.push({ k, opts }) },
  },
  ...over,
})

// ---------- in-memory Firestore ----------

let docs      // `${project}|${path}` -> REST fields
let reads     // [{ project, kind: 'get'|'query', target }]
let failing   // `${project}|${collection}` -> HTTP status that query answers with
const seed = (project, path, obj) => { docs.set(`${project}|${path}`, encodeFields(obj)) }

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

  if (url.startsWith('https://www.googleapis.com/robot/v1/metadata/jwk/')) return json({ keys: [JWK] })
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'sa-access', expires_in: 3600 })

  const q = /\/projects\/([^/]+)\/databases\/\(default\)\/documents:runQuery$/.exec(url)
  if (q) {
    const project = q[1]
    const sq = JSON.parse(init.body).structuredQuery
    const collection = sq.from[0].collectionId
    reads.push({ project, kind: 'query', target: collection, where: sq.where, limit: sq.limit })
    // A string means the connection itself fails with that message, not an HTTP status.
    if (typeof failing.get(`${project}|${collection}`) === 'string') throw new TypeError(failing.get(`${project}|${collection}`))
    if (failing.has(`${project}|${collection}`)) return json({ error: { message: 'secret detail from Google' } }, failing.get(`${project}|${collection}`))
    const rows = [...docs.entries()]
      .filter(([k]) => k.startsWith(`${project}|${collection}/`) && k.split('/').length === 2)
      .map(([k, fields]) => ({ document: { name: `x/${k.split('/').pop()}`, fields } }))
    return json(rows.length ? rows : [{}])
  }

  const m = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/([^/]+)\/databases\/\(default\)\/documents\/(.*)$/.exec(url)
  if (m) {
    const [, project, rawPath] = m
    const path = decodeURIComponent(rawPath)
    reads.push({ project, kind: 'get', target: path })
    return docs.has(`${project}|${path}`) ? json({ fields: docs.get(`${project}|${path}`) }) : new Response('{}', { status: 404 })
  }
  throw new Error(`unexpected fetch in test: ${init.method || 'GET'} ${url}`)
}

beforeEach(() => {
  docs = new Map(); reads = []; kv = new Map(); kvPuts = []; failing = new Map()
  seed(MSG, 'users/u1', { name: 'Dev', role: 'developer' })
  seed(MSG, 'users/emp', { name: 'Emp', role: 'employee' })
  seed(MSG, 'users/sa', { name: 'Super', role: 'super_admin' })
  seed(MSG, 'users/gone', { name: 'Gone', role: 'developer', deactivated: true })
})

const get = (path, { auth = `Bearer ${token()}`, over } = {}) =>
  worker.fetch(new Request(`https://worker.test${path}`, { headers: auth ? { Authorization: auth, Origin: 'https://plexus.punxai.online' } : {} }), env(over))

const dtrReads = () => reads.filter(r => r.project === DTR)

// ---------- the vendored DTR holiday rules ----------

describe('the holiday rules copied from the DTR app', () => {
  test('2026 has the 17 built-in Philippine holidays, in date order', () => {
    const h = holidaysForYears([2026])
    assert.equal(h.length, 17)
    assert.deepEqual(h.map(x => x.date), [...h.map(x => x.date)].sort())
    const byName = Object.fromEntries(h.map(x => [x.name, x.date]))
    assert.equal(byName["New Year's Day"], '2026-01-01')
    assert.equal(byName['Good Friday'], '2026-04-03', 'Easter 2026 is 5 April')
    assert.equal(byName['National Heroes Day'], '2026-08-31', 'last Monday of August')
    assert.equal(byName['Christmas Day'], '2026-12-25')
    assert.equal(byName['Chinese New Year'], '2026-02-17')
  })

  test('HR can hide a built-in holiday, rename one, and add a repeating company holiday', () => {
    const stored = [
      { id: 'ph-2026-12-24', hidden: true },
      { id: 'ph-2026-12-25', date: '2026-12-25', name: 'Pasko', type: 'regular' },
      { id: 'c1', date: '2026-12-15', endDate: '2026-12-16', name: 'Company break', type: 'company', recurring: true },
    ]
    const h = holidaysForYears([2026, 2027], stored)
    assert.ok(!h.some(x => x.date === '2026-12-24'), 'hidden')
    assert.equal(h.find(x => x.date === '2026-12-25').name, 'Pasko')
    assert.equal(h.filter(x => x.name === 'Company break').length, 2, 'once a year')
    assert.deepEqual(h.find(x => x.id === 'c1@2027') && [h.find(x => x.id === 'c1@2027').date, h.find(x => x.id === 'c1@2027').endDate], ['2027-12-15', '2027-12-16'])
  })

  test('dates are read as local days, and an impossible one is refused', () => {
    assert.equal(toYMD(parseYMD('2026-02-28')), '2026-02-28')
    assert.equal(parseYMD('2026-02-31'), null)
    assert.equal(parseYMD('26-2-1'), null)
    assert.equal(parseYMD(undefined), null)
  })
})

// ---------- month maths ----------

describe('parseMonth', () => {
  test('accepts YYYY-MM and nothing else', () => {
    assert.deepEqual(parseMonth('2026-11'), { year: 2026, month: 11 })
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-11', '2026-11-01', '', null, undefined, '1999-12', '2101-01', '2026/11', ' 2026-11', '2026-11\n']) {
      assert.throws(() => parseMonth(bad), (e) => e.status === 400, String(bad))
    }
  })
})

describe('gridRange', () => {
  test('is the whole weeks the Sunday-first grid shows', () => {
    // 1 Nov 2026 is a Sunday and 30 Nov a Monday.
    assert.deepEqual(gridRange({ year: 2026, month: 11 }), { from: '2026-11-01', to: '2026-12-05' })
    // 1 Oct 2026 is a Thursday and 31 Oct a Saturday.
    assert.deepEqual(gridRange({ year: 2026, month: 10 }), { from: '2026-09-27', to: '2026-10-31' })
    // February 2026 starts on a Sunday and ends on a Saturday: exactly four rows.
    assert.deepEqual(gridRange({ year: 2026, month: 2 }), { from: '2026-02-01', to: '2026-02-28' })
  })
  test('crosses a year', () => {
    assert.deepEqual(gridRange({ year: 2026, month: 12 }), { from: '2026-11-29', to: '2027-01-02' })
    assert.deepEqual(gridRange({ year: 2027, month: 1 }), { from: '2026-12-27', to: '2027-02-06' })
  })
  test('a leap day is a day', () => {
    const r = gridRange({ year: 2028, month: 2 })
    assert.equal(r.from, '2028-01-30')
    assert.equal(r.to, '2028-03-04')
  })
})

describe('calendarRoles', () => {
  test('developers only unless configured', () => {
    assert.deepEqual(calendarRoles({}), ['developer'])
    assert.deepEqual(calendarRoles({ DTR_CALENDAR_ROLES: '' }), ['developer'])
    assert.deepEqual(calendarRoles({ DTR_CALENDAR_ROLES: ' , ,' }), ['developer'])
    assert.deepEqual(calendarRoles({ DTR_CALENDAR_ROLES: 'developer, super_admin' }), ['developer', 'super_admin'])
  })
})

// ---------- what comes back ----------

describe('shapeCalendar', () => {
  test('a month with a year boundary carries the holidays of both years', () => {
    const c = shapeCalendar({ month: '2026-12' })
    const names = c.holidays.map(h => `${h.date} ${h.name}`)
    assert.ok(names.includes('2026-11-30 Bonifacio Day'), 'a padding day before the month')
    assert.ok(names.includes('2026-12-25 Christmas Day'))
    assert.ok(names.includes("2027-01-01 New Year's Day"), 'a padding day after the month, in the next year')
    assert.deepEqual(c.holidays.map(h => h.date), [...c.holidays.map(h => h.date)].sort())
  })

  test('only holidays that touch the grid are included', () => {
    // July 2026's grid is 28 June to 1 August: no holiday falls in it.
    assert.deepEqual(shapeCalendar({ month: '2026-07' }).holidays, [])
    // March 2026's grid runs to 4 April, so Holy Week's first days show on its last row.
    assert.deepEqual(shapeCalendar({ month: '2026-03' }).holidays.map(h => h.date), ['2026-04-02', '2026-04-03', '2026-04-04'])
  })

  test('leave: the overlapping ones, with exactly the fields the widget draws', () => {
    const c = shapeCalendar({
      month: '2026-11',
      events: [
        { id: 'a', userName: ' Ana Reyes ', departmentId: 'd1', type: 'sick', startDate: '2026-11-10', endDate: '2026-11-12', hours: 0 },
        { id: 'b', userName: 'Ben', departmentId: 'd2', type: 'offset', startDate: '2026-11-20', endDate: '2026-11-20', hours: 4 },
        { id: 'before', userName: 'X', type: 'vacation', startDate: '2026-10-01', endDate: '2026-10-31' },
        { id: 'after', userName: 'Y', type: 'vacation', startDate: '2026-12-06', endDate: '2026-12-08' },
        { id: 'edge', userName: 'Zed', type: 'vacation', startDate: '2026-12-04', endDate: '2026-12-09' },
      ],
    })
    assert.deepEqual(c.leaves.map(l => l.id), ['a', 'b', 'edge'])
    assert.deepEqual(Object.keys(c.leaves[0]).sort(), ['departmentId', 'endDate', 'hours', 'id', 'startDate', 'type', 'userName'])
    assert.equal(c.leaves[0].userName, 'Ana Reyes', 'trimmed')
  })

  test('a reason, or anything else on the document, never leaves', () => {
    const c = shapeCalendar({
      month: '2026-11',
      events: [{ id: 'a', userName: 'Ana', type: 'sick', startDate: '2026-11-10', endDate: '2026-11-10', reason: 'chemo', userId: 'secret-uid', note: 'private', requestId: 'r1' }],
    })
    const text = JSON.stringify(c)
    for (const leak of ['chemo', 'secret-uid', 'private', 'r1', 'reason', 'userId']) assert.ok(!text.includes(leak), leak)
  })

  test('malformed leave is dropped instead of breaking the month', () => {
    const c = shapeCalendar({
      month: '2026-11',
      events: [
        null, {}, { type: 'sick' },
        { id: '1', userName: 'A', type: 'sabbatical', startDate: '2026-11-10', endDate: '2026-11-10' },
        { id: '2', userName: 'B', type: 'sick', startDate: '2026-11-31', endDate: '2026-11-31' },
        { id: '3', userName: 'C', type: 'sick', startDate: 'x', endDate: '2026-11-10' },
        { id: '4', userName: 'D', type: 'sick', startDate: '2026-11-10', endDate: '2026-11-10' },
      ].filter(Boolean),
    })
    assert.deepEqual(c.leaves.map(l => l.id), ['4'])
  })

  test('long text is cut and a missing name still reads as a person', () => {
    const c = shapeCalendar({
      month: '2026-11',
      events: [
        { id: 'a', userName: 'N'.repeat(500), type: 'sick', startDate: '2026-11-10', endDate: '2026-11-10' },
        { id: 'b', type: 'sick', startDate: '2026-11-11', endDate: '2026-11-11' },
      ],
    })
    assert.equal(c.leaves[0].userName.length, 80)
    assert.equal(c.leaves[1].userName, 'Someone')
  })

  test('departments become an id -> name map', () => {
    const c = shapeCalendar({ month: '2026-11', departments: [{ id: 'd1', name: 'Creatives' }, { id: 'd2' }, { name: 'no id' }] })
    assert.deepEqual(c.departments, { d1: 'Creatives' })
  })
})

// ---------- the route ----------

describe('GET /dtr/calendar', () => {
  beforeEach(() => {
    seed(DTR, 'calendarEvents/e1', { userName: 'Ana Reyes', departmentId: 'd1', type: 'sick', startDate: '2026-11-10', endDate: '2026-11-11', hours: 0, reason: 'private reason', userId: 'dtr-uid' })
    seed(DTR, 'holidays/c1', { date: '2026-11-20', name: 'Company day', type: 'company' })
    seed(DTR, 'departments/d1', { name: 'Creatives' })
    seed(DTR, 'leaveRequests/e1', { reason: 'private reason' })
    seed(DTR, 'users/dtr-uid', { email: 'ana@punx.ai' })
  })

  test('a developer gets the month', async () => {
    const res = await get('/dtr/calendar?month=2026-11')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.month, '2026-11')
    assert.deepEqual(body.leaves.map(l => l.userName), ['Ana Reyes'])
    assert.ok(body.holidays.some(h => h.name === 'Company day' && h.date === '2026-11-20'))
    assert.ok(body.holidays.some(h => h.name === "All Saints' Day"))
    assert.deepEqual(body.departments, { d1: 'Creatives' })
    assert.ok(!JSON.stringify(body).includes('private reason'))
    assert.ok(!JSON.stringify(body).includes('dtr-uid'))
  })

  test('is private to the caller and carries CORS for the app', async () => {
    const res = await get('/dtr/calendar?month=2026-11')
    assert.match(res.headers.get('Cache-Control'), /private/)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://plexus.punxai.online')
  })

  test('reads only the three calendar collections of the DTR, never requests, users or anything else', async () => {
    await get('/dtr/calendar?month=2026-11')
    const targets = dtrReads().map(r => r.target).sort()
    assert.deepEqual(targets, ['calendarEvents', 'departments', 'holidays'])
    assert.ok(dtrReads().every(r => r.kind === 'query'))
  })

  test('asks Firestore for events ending on or after the first grid day', async () => {
    await get('/dtr/calendar?month=2026-11')
    const q = reads.find(r => r.target === 'calendarEvents')
    assert.equal(q.where.fieldFilter.field.fieldPath, 'endDate')
    assert.equal(q.where.fieldFilter.op, 'GREATER_THAN_OR_EQUAL')
    assert.equal(q.where.fieldFilter.value.stringValue, '2026-11-01')
    assert.ok(q.limit > 0 && q.limit <= 2000)
  })

  test('needs a signed-in messenger user', async () => {
    assert.equal((await get('/dtr/calendar?month=2026-11', { auth: null })).status, 401)
    assert.equal((await get('/dtr/calendar?month=2026-11', { auth: 'Bearer not.a.token' })).status, 401)
    assert.equal((await get('/dtr/calendar?month=2026-11', { auth: `Bearer ${token({ expOffset: -3600 })}` })).status, 401, 'expired')
    assert.equal((await get('/dtr/calendar?month=2026-11', { auth: `Bearer ${token({ project: DTR })}` })).status, 401, 'a token from the DTR project is not a messenger sign-in')
    assert.equal((await get('/dtr/calendar?month=2026-11', { auth: `Bearer ${token({ email: 'x@gmail.com' })}` })).status, 403, 'a stranger')
    assert.equal(dtrReads().length, 0, 'nothing of the DTR was read for any of them')
  })

  test('only the allowed roles get in, and the DTR is not even read for anyone else', async () => {
    for (const uid of ['emp', 'sa', 'gone', 'nobody']) {
      const res = await get('/dtr/calendar?month=2026-11', { auth: `Bearer ${token({ uid })}` })
      assert.equal(res.status, 403, uid)
    }
    assert.equal(dtrReads().length, 0)
    assert.equal(kvPuts.filter(p => p.k.startsWith('dtrcal:')).length, 0, 'and nothing was cached for them')
  })

  test('the role list can be widened, and the check still runs on every request', async () => {
    const wide = { DTR_CALENDAR_ROLES: 'developer,super_admin' }
    assert.equal((await get('/dtr/calendar?month=2026-11', { auth: `Bearer ${token({ uid: 'sa' })}`, over: wide })).status, 200)
    assert.equal((await get('/dtr/calendar?month=2026-11', { auth: `Bearer ${token({ uid: 'emp' })}`, over: wide })).status, 403)
    // Demoted between two requests: the second is refused even though the month is cached.
    assert.equal((await get('/dtr/calendar?month=2026-11')).status, 200)
    seed(MSG, 'users/u1', { name: 'Dev', role: 'employee' })
    assert.equal((await get('/dtr/calendar?month=2026-11')).status, 403)
  })

  test('rejects a bad month before touching anything', async () => {
    for (const m of ['', '2026-13', 'now', '../x', '2026-11-01']) {
      const res = await get(`/dtr/calendar?month=${encodeURIComponent(m)}`)
      assert.equal(res.status, 400, m)
    }
    assert.equal((await get('/dtr/calendar')).status, 400)
    assert.equal(reads.length, 0)
  })

  test('a month is read once and then served from the cache for five minutes', async () => {
    await get('/dtr/calendar?month=2026-11')
    const first = dtrReads().length
    assert.equal(first, 3)
    const again = await get('/dtr/calendar?month=2026-11')
    assert.equal(again.status, 200)
    assert.equal(dtrReads().length, first, 'no further DTR reads')
    const put = kvPuts.find(p => p.k === 'dtrcal:v1:2026-11')
    assert.ok(put)
    assert.equal(put.opts.expirationTtl, 300)
    await get('/dtr/calendar?month=2026-12')
    assert.equal(dtrReads().length, first * 2, 'another month is another read')
  })

  test('when a DTR read fails, the answer says which one and with what status, and nothing else of Google leaks', async () => {
    failing.set(`${DTR}|calendarEvents`, 403)
    const res = await get('/dtr/calendar?month=2026-11')
    assert.equal(res.status, 502)
    const { error } = await res.json()
    assert.equal(error, 'reading DTR calendarEvents: Firestore query failed (403)')
    assert.ok(!error.includes('secret detail'), "Google's own error body is not passed on")
    assert.equal(kvPuts.filter(p => p.k.startsWith('dtrcal:')).length, 0, 'a failed month is not cached')
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://plexus.punxai.online', 'the app can still read the reason')

    failing.clear()
    failing.set(`${DTR}|holidays`, 500)
    assert.equal((await (await get('/dtr/calendar?month=2026-11')).json()).error, 'reading DTR holidays: Firestore query failed (500)')
  })

  test('a dropped connection is named by kind, and a very long message is cut short', async () => {
    failing.set(`${DTR}|departments`, 'fetch failed')
    const res = await get('/dtr/calendar?month=2026-11')
    assert.equal(res.status, 502)
    assert.equal((await res.json()).error, 'reading DTR departments: TypeError: fetch failed')

    failing.set(`${DTR}|departments`, 'x'.repeat(500))
    const { error } = await (await get('/dtr/calendar?month=2026-11')).json()
    assert.equal(error.length, 'reading DTR departments: '.length + 160)
  })

  test('a missing DTR service account is named, and still only for an allowed role', async () => {
    const res = await get('/dtr/calendar?month=2026-11', { over: { DTR_SERVICE_ACCOUNT: '' } })
    assert.equal(res.status, 503)
    assert.match((await res.json()).error, /DTR_SERVICE_ACCOUNT is unset/)
    const refused = await get('/dtr/calendar?month=2026-11', { auth: `Bearer ${token({ uid: 'emp' })}`, over: { DTR_SERVICE_ACCOUNT: '' } })
    assert.equal(refused.status, 403, 'an employee is told nothing about the configuration')
    assert.equal((await refused.json()).error, 'The calendar is not available to this account')
  })

  test('a cache that cannot be written does not stop the month being served', async () => {
    // The same KV also holds Google's sign-in keys, so only the calendar's own write fails.
    const flaky = { get: async () => null, put: async (k) => { if (k.startsWith('dtrcal:')) throw new Error('KV down') } }
    const res = await get('/dtr/calendar?month=2026-11', { over: { JWKS_CACHE: flaky } })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).month, '2026-11')
  })

  test('other methods are not served', async () => {
    const res = await worker.fetch(new Request('https://worker.test/dtr/calendar?month=2026-11', { method: 'POST', headers: { Authorization: `Bearer ${token()}` } }), env())
    assert.notEqual(res.status, 200)
  })
})
