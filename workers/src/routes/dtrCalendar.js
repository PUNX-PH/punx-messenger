import { AuthError, verifyAuth } from '../auth.js'
import { firestoreGet, firestoreQuery, loadServiceAccount } from '../googleAuth.js'
import { holidaysForYears, parseYMD, toYMD } from '../lib/dtrHolidays.js'

// The DTR company calendar, for the messenger's calendar widget: Philippine and
// company holidays, and everyone's approved leave and offsets, for one month.
//
// Why a Worker route: the DTR app is a SEPARATE Firebase project (punx-dtr) with its
// own sign-in, so a messenger client cannot read it (docs/DTR.md, "Two Firebase
// projects"). The Worker already holds a service account for each project, so it
// reads the DTR's data and hands over only what the calendar draws.
//
// What leaves here, and what does not:
//   - Holidays: built by the DTR's own rules (lib/dtrHolidays.js), with HR's edits.
//   - Leave: person's name, department, type, dates, offset hours. NEVER a reason,
//     and every field is copied by name rather than passed through, so a field that
//     is ever added to a calendarEvents document cannot reach a messenger client.
//     (The DTR keeps reasons out of calendarEvents on purpose, firestore.rules there.)
//
// Who may ask: a signed-in messenger user whose role (read from users/{uid} on
// EVERY request, not from a token claim, so removing a role takes effect at once) is
// in DTR_CALENDAR_ROLES. The default is "developer" only, matching the toolbox in
// the client (src/lib/apps.js), which hides the entry point for everyone else. The
// client hiding it is a convenience; THIS check is the one that holds.

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const LEAVE_TYPES = ['sick', 'vacation', 'offset']
const CACHE_SECONDS = 300 // one Firestore read pass per month per five minutes, however many people ask

export const DEFAULT_CALENDAR_ROLES = ['developer']

/** The roles allowed in: DTR_CALENDAR_ROLES ("developer,super_admin"), or developers only. */
export function calendarRoles(env) {
  const list = String(env.DTR_CALENDAR_ROLES ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return list.length ? list : DEFAULT_CALENDAR_ROLES
}

/** "2026-11" -> { year: 2026, month: 11 }, or a 400. */
export function parseMonth(value) {
  const m = MONTH_RE.exec(String(value ?? ''))
  if (!m) throw new AuthError('month must look like 2026-11', 400)
  const year = Number(m[1])
  if (year < 2000 || year > 2100) throw new AuthError('month is out of range', 400)
  return { year, month: Number(m[2]) }
}

/**
 * The days a Sunday-first month grid shows, padded to whole weeks with the
 * neighbouring months' days: { from, to } as YYYY-MM-DD. The widget draws those
 * days too, so what happens on them has to be included.
 */
export function gridRange({ year, month }) {
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const from = new Date(year, month - 1, 1 - first.getDay())
  const to = new Date(year, month - 1, last.getDate() + (6 - last.getDay()))
  return { from: toYMD(from), to: toYMD(to) }
}

const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '')

/**
 * What the widget gets, from the raw documents. Pure, so it is tested without a
 * database. `events` are calendarEvents docs; `storedHolidays` are the DTR's holidays
 * docs; `departments` the DTR's departments docs.
 */
export function shapeCalendar({ month, storedHolidays = [], events = [], departments = [] }) {
  const { year, month: m } = parseMonth(month)
  const { from, to } = gridRange({ year, month: m })
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])]

  const holidays = holidaysForYears(years, storedHolidays)
    .filter(h => h.endDate >= from && h.date <= to)
    .map(h => ({ id: h.id, name: clean(h.name, 120) || 'Holiday', type: h.type, date: h.date, endDate: h.endDate }))

  const leaves = []
  for (const e of events) {
    if (!LEAVE_TYPES.includes(e.type)) continue
    if (!parseYMD(e.startDate) || !parseYMD(e.endDate)) continue
    if (e.endDate < from || e.startDate > to) continue
    leaves.push({
      id: clean(e.id, 80),
      userName: clean(e.userName, 80) || 'Someone',
      departmentId: clean(e.departmentId, 80),
      type: e.type,
      startDate: e.startDate,
      endDate: e.endDate,
      hours: Number.isFinite(Number(e.hours)) ? Number(e.hours) : 0,
    })
  }
  leaves.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.userName.localeCompare(b.userName))

  const deptNames = {}
  for (const d of departments) if (d?.id && typeof d.name === 'string') deptNames[d.id] = clean(d.name, 80)

  return { month, from, to, holidays, leaves, departments: deptNames }
}

/**
 * One line saying what went wrong, for the caller. Only a developer gets this far (the
 * role check is first), and what goes in it is our own wording and an HTTP status, never
 * a key or a document, so it is safe to hand back. Without it the widget could only say
 * "couldn't load" and the cause would sit in a log nobody has open.
 */
const reason = (err) => String(err instanceof AuthError ? err.message : `${err?.name || 'Error'}: ${err?.message || err}`).slice(0, 160)

/** Runs one step of the load; if it fails, the failure says which step. */
const step = (name, work) => Promise.resolve().then(work).catch((err) => {
  console.error(`[dtr-calendar] ${name} failed:`, err)
  throw new AuthError(`${name}: ${reason(err)}`, 502)
})

/** Reads the three DTR collections the calendar needs. */
async function readDtr(env, from) {
  const dtrSa = loadServiceAccount(env, 'DTR_SERVICE_ACCOUNT')
  const project = env.DTR_PROJECT_ID
  const read = (collection, query) => step(`reading DTR ${collection}`, () => firestoreQuery(env, dtrSa, { from: [{ collectionId: collection }], ...query }, project))
  const [storedHolidays, events, departments] = await Promise.all([
    read('holidays', { limit: 1000 }),
    // Dates are YYYY-MM-DD strings, so they compare as text. One range filter only (on
    // endDate); the other end of the overlap is checked in shapeCalendar.
    read('calendarEvents', {
      where: { fieldFilter: { field: { fieldPath: 'endDate' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: from } } },
      orderBy: [{ field: { fieldPath: 'endDate' }, direction: 'ASCENDING' }],
      limit: 2000,
    }),
    read('departments', { limit: 500 }),
  ])
  return { storedHolidays, events, departments }
}

/** GET /dtr/calendar?month=2026-11 */
export async function getCalendar(request, env) {
  const url = new URL(request.url)
  const parsed = parseMonth(url.searchParams.get('month'))
  const month = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`

  // Who is asking, and are they allowed? Before anything is read or cached.
  const caller = await verifyAuth(request, env)
  const msgSa = loadServiceAccount(env)
  const profile = await firestoreGet(env, msgSa, `users/${caller.uid}`)
  if (!profile || profile.deactivated === true || !calendarRoles(env).includes(profile.role)) {
    throw new AuthError('The calendar is not available to this account', 403)
  }

  const key = `dtrcal:v1:${month}`
  let body = await step('reading the cache', () => env.JWKS_CACHE.get(key))
  if (!body) {
    const raw = await readDtr(env, gridRange(parsed).from)
    body = await step('shaping the month', () => JSON.stringify(shapeCalendar({ month, ...raw })))
    // The cache is a convenience: if it cannot be written the month is still served.
    try { await env.JWKS_CACHE.put(key, body, { expirationTtl: CACHE_SECONDS }) } catch (err) { console.error('[dtr-calendar] cache write failed:', err) }
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      // It names people and is for this one signed-in caller; no shared cache may keep it.
      'Cache-Control': 'private, max-age=60',
    },
  })
}
