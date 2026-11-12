// The calendar widget's logic: the month grid, what lands on each day, the wording, the
// pin, and the cache of fetched months. Plus guards on the wiring that has no DOM test.
//
//   node --test tests/dtr-calendar.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  CALENDAR_CACHE_MS, LEAVE_TYPES, MAX_HOLIDAY_DAYS, OPEN_CALENDAR_EVENT, PINNED_KEY, addMonths, createCalendarCache,
  dayLabel, describeCalendarFailure, eventsForDate, holidaysByDate, leaveLine, leavesOnDate, monthGrid, monthKey,
  monthKeyOf, monthTitle, parseMonthKey, parseYMD, readPinned, toYMD, upcomingHolidays, writePinned,
} from '../src/lib/dtrCalendar.js'
import { gridRange } from '../workers/src/routes/dtrCalendar.js'

const lf = (s) => s.replace(/\r\n/g, '\n')

// ---------- dates and months ----------

test('days are local YYYY-MM-DD and an impossible one is refused', () => {
  assert.equal(toYMD(new Date(2026, 10, 5)), '2026-11-05')
  assert.equal(toYMD(parseYMD('2026-02-28')), '2026-02-28')
  for (const bad of ['2026-02-31', '2026-13-01', '2026-1-1', '26-11-05', '', 'x', null, undefined, 20261105, '2026-11-05T00:00:00']) {
    assert.equal(parseYMD(bad), null, String(bad))
  }
  assert.equal(toYMD(parseYMD('2028-02-29')), '2028-02-29', 'a leap day')
  assert.equal(parseYMD('2027-02-29'), null)
})

test('month keys are YYYY-MM with a 1-based month', () => {
  assert.deepEqual(parseMonthKey('2026-11'), { year: 2026, month: 11 })
  assert.equal(monthKey({ year: 2026, month: 3 }), '2026-03')
  assert.equal(monthKeyOf(new Date(2026, 0, 31)), '2026-01')
  for (const bad of ['2026-00', '2026-13', '2026-1', '2026-11-01', '', null, undefined, 202611]) assert.equal(parseMonthKey(bad), null, String(bad))
  assert.equal(monthTitle('2026-11'), 'November 2026')
  assert.equal(monthTitle('nope'), '')
})

test('stepping a month rolls the year in both directions', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01')
  assert.equal(addMonths('2026-01', -1), '2025-12')
  assert.equal(addMonths('2026-11', 0), '2026-11')
  assert.equal(addMonths('2026-03', 14), '2027-05')
  assert.equal(addMonths('2026-03', -15), '2024-12')
  assert.equal(addMonths('garbage', 1), 'garbage', 'an unreadable key is left alone')
})

// ---------- the grid ----------

test('a month grid is whole Sunday-first weeks that hold every day of the month once', () => {
  for (let y = 2020; y <= 2036; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = monthKey({ year: y, month: m })
      const g = monthGrid(key)
      assert.equal(g.length % 7, 0, key)
      assert.ok(g.length >= 28 && g.length <= 42, key + ' rows')
      assert.equal(parseYMD(g[0].ymd).getDay(), 0, key + ' starts on a Sunday')
      assert.equal(parseYMD(g.at(-1).ymd).getDay(), 6, key + ' ends on a Saturday')
      const inMonth = g.filter(c => c.inMonth)
      assert.equal(inMonth.length, new Date(y, m, 0).getDate(), key)
      assert.deepEqual(inMonth.map(c => c.day), Array.from({ length: inMonth.length }, (_, i) => i + 1), key + ' in order')
      assert.equal(new Set(g.map(c => c.ymd)).size, g.length, key + ' no repeats')
      // consecutive days
      for (let i = 1; i < g.length; i++) assert.equal(g[i].ymd > g[i - 1].ymd, true)
      // neighbours flagged as outside
      assert.ok(g.every(c => c.inMonth === c.ymd.startsWith(key)), key)
    }
  }
})

test('known grids: February 2026 is four rows, August 2026 is six', () => {
  assert.equal(monthGrid('2026-02').length, 28)
  assert.equal(monthGrid('2026-08').length, 42)
  assert.equal(monthGrid('2026-11')[0].ymd, '2026-11-01')
  assert.equal(monthGrid('2026-11').at(-1).ymd, '2026-12-05')
  assert.deepEqual(monthGrid('garbage'), [])
})

test('the grid shows exactly the days the Worker fetches events for, in every month', () => {
  // If these ever differ, a day on the grid would have no events (or events would be
  // fetched for days nobody sees): the two sides compute the range independently.
  for (let y = 2020; y <= 2036; y++) {
    for (let m = 1; m <= 12; m++) {
      const g = monthGrid(monthKey({ year: y, month: m }))
      const r = gridRange({ year: y, month: m })
      assert.equal(g[0].ymd, r.from, `${y}-${m} from`)
      assert.equal(g.at(-1).ymd, r.to, `${y}-${m} to`)
    }
  }
})

// ---------- holidays and leave on a day ----------

test('a holiday that spans days is on every one of them, with its place in the run', () => {
  const idx = holidaysByDate([{ id: 'h', name: 'Break', type: 'company', date: '2026-12-30', endDate: '2027-01-01' }])
  assert.deepEqual(Object.keys(idx), ['2026-12-30', '2026-12-31', '2027-01-01'])
  assert.deepEqual(idx['2026-12-31'].map(h => [h.day, h.days]), [[2, 3]])
})

test('two holidays can share a day, a missing end is one day, and a bad one is skipped', () => {
  const idx = holidaysByDate([
    { id: 'a', name: 'A', date: '2026-05-01', endDate: '2026-05-01' },
    { id: 'b', name: 'B', date: '2026-05-01' },
    { id: 'c', name: 'C', date: '2026-05-10', endDate: '2026-05-01' },
    { id: 'd', name: 'D', date: 'nope' },
    null,
  ])
  assert.equal(idx['2026-05-01'].length, 2)
  assert.deepEqual(Object.keys(idx).sort(), ['2026-05-01', '2026-05-10'])
  assert.equal(idx['2026-05-10'][0].days, 1, 'an end before the start is one day')
  assert.deepEqual(holidaysByDate(), {})
})

test('a typo in the end date cannot paint a whole year', () => {
  const idx = holidaysByDate([{ id: 'x', name: 'X', date: '2026-01-01', endDate: '2030-01-01' }])
  assert.equal(Object.keys(idx).length, MAX_HOLIDAY_DAYS)
})

test('leave covers its whole range, edges included', () => {
  const l = [{ id: 'a', userName: 'Ana', type: 'vacation', startDate: '2026-11-10', endDate: '2026-11-12' }]
  assert.equal(leavesOnDate(l, '2026-11-09').length, 0)
  for (const d of ['2026-11-10', '2026-11-11', '2026-11-12']) assert.equal(leavesOnDate(l, d).length, 1, d)
  assert.equal(leavesOnDate(l, '2026-11-13').length, 0)
})

test('day-based leave skips the weekend, so a Friday-to-Monday sick leave does not paint it', () => {
  const l = [{ id: 'a', userName: 'Ana', type: 'sick', startDate: '2026-11-06', endDate: '2026-11-09' }]
  assert.equal(leavesOnDate(l, '2026-11-06').length, 1, 'Friday')
  assert.equal(leavesOnDate(l, '2026-11-07').length, 0, 'Saturday')
  assert.equal(leavesOnDate(l, '2026-11-08').length, 0, 'Sunday')
  assert.equal(leavesOnDate(l, '2026-11-09').length, 1, 'Monday')
})

test('an offset claims its date even on a weekend, and an unreadable day matches nothing', () => {
  const l = [{ id: 'a', userName: 'Ben', type: 'offset', startDate: '2026-11-08', endDate: '2026-11-08', hours: 4 }]
  assert.equal(leavesOnDate(l, '2026-11-08').length, 1)
  assert.deepEqual(leavesOnDate(l, 'x'), [])
  assert.deepEqual(leavesOnDate(undefined, '2026-11-08'), [])
})

test('a day gives its holidays and its leave together', () => {
  const holidayIndex = holidaysByDate([{ id: 'h', name: 'H', date: '2026-11-10', endDate: '2026-11-10', type: 'regular' }])
  const leaves = [{ id: 'a', userName: 'Ana', type: 'sick', startDate: '2026-11-10', endDate: '2026-11-10' }]
  const e = eventsForDate('2026-11-10', { holidayIndex, leaves })
  assert.equal(e.holidays.length, 1)
  assert.equal(e.leaves.length, 1)
  assert.deepEqual(eventsForDate('2026-11-11', { holidayIndex, leaves }), { holidays: [], leaves: [] })
  assert.deepEqual(eventsForDate('2026-11-11'), { holidays: [], leaves: [] })
})

// ---------- wording ----------

test('a leave reads "name · tag", with hours for an offset', () => {
  assert.equal(leaveLine({ userName: 'Ana Reyes', type: 'sick' }), 'Ana Reyes · SL')
  assert.equal(leaveLine({ userName: 'Ana', type: 'vacation' }), 'Ana · VL')
  assert.equal(leaveLine({ userName: 'Ben', type: 'offset', hours: 4 }), 'Ben · OFFSET 4h')
  assert.equal(leaveLine({ userName: 'Ben', type: 'offset', hours: 0 }), 'Ben · OFFSET')
  assert.equal(leaveLine({ userName: 'Cy', type: 'sick', hours: 4 }), 'Cy · SL', 'hours only matter for an offset')
  assert.equal(leaveLine({ userName: 'Di', type: 'sabbatical' }), 'Di · sabbatical')
  assert.deepEqual(Object.keys(LEAVE_TYPES).sort(), ['offset', 'sick', 'vacation'])
})

test('a day is labelled "Tue, Nov 10"', () => {
  assert.equal(dayLabel('2026-11-10'), 'Tue, Nov 10')
  assert.equal(dayLabel('2026-12-25'), 'Fri, Dec 25')
  assert.equal(dayLabel('nope'), '')
})

test('the next few holidays, soonest first, including one that is under way', () => {
  const hs = [
    { date: '2026-12-25', endDate: '2026-12-25', name: 'Christmas' },
    { date: '2026-11-01', endDate: '2026-11-01', name: 'Past' },
    { date: '2026-11-29', endDate: '2026-12-02', name: 'Break' },
    { date: '2026-11-30', endDate: '2026-11-30', name: 'Bonifacio' },
    { date: '2026-12-08', endDate: '2026-12-08', name: 'Immaculate' },
  ]
  assert.deepEqual(upcomingHolidays(hs, '2026-11-30', 3).map(h => h.name), ['Break', 'Bonifacio', 'Immaculate'])
  assert.deepEqual(upcomingHolidays(hs, '2027-01-01'), [])
})

// ---------- the pin ----------

const fakeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) }, raw: m }
}

test('a pinned calendar is remembered and an unpinned one is forgotten', () => {
  const s = fakeStorage()
  assert.equal(readPinned(s), false)
  writePinned(s, true)
  assert.equal(readPinned(s), true)
  assert.equal(s.raw.get(PINNED_KEY), '1')
  writePinned(s, false)
  assert.equal(readPinned(s), false)
  assert.equal(s.raw.has(PINNED_KEY), false, 'removed, not left as "0"')
})

test('only the exact stored value counts, and broken or missing storage never throws', () => {
  for (const v of ['0', '', 'true', 'yes', '11']) assert.equal(readPinned(fakeStorage({ [PINNED_KEY]: v })), false, v)
  const throwing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.equal(readPinned(throwing), false)
  assert.doesNotThrow(() => writePinned(throwing, true))
  assert.doesNotThrow(() => writePinned(throwing, false))
  assert.equal(readPinned(null), false)
  assert.doesNotThrow(() => writePinned(undefined, true))
})

// ---------- failures ----------

test('a failed load says what is wrong in plain words, and whether retrying can help', () => {
  assert.equal(describeCalendarFailure(403).retryable, false)
  assert.equal(describeCalendarFailure(401).message, describeCalendarFailure(403).message)
  assert.match(describeCalendarFailure(403).message, /isn't available to your account/)
  assert.equal(describeCalendarFailure(0).retryable, true)
  assert.match(describeCalendarFailure(0).message, /connection/)
  assert.equal(describeCalendarFailure(502).retryable, true)
  assert.equal(describeCalendarFailure(500).retryable, true)
  assert.equal(describeCalendarFailure(400).retryable, false)
  for (const s of [0, 400, 401, 403, 500, 502, 503, 404]) {
    const { message } = describeCalendarFailure(s)
    assert.doesNotMatch(message, /\d{3}|Firestore|permission-denied|worker/i, 'no raw codes or internals in what a person reads')
  }
})

// ---------- the cache of fetched months ----------

const clock = () => { let t = 1000; return { now: () => t, advance: (ms) => { t += ms } } }

test('a month is fetched once, then served from memory', async () => {
  let calls = 0
  const c = createCalendarCache(async (k) => { calls++; return { k } }, { now: clock().now })
  assert.deepEqual(await c.get('2026-11'), { k: '2026-11' })
  assert.deepEqual(await c.get('2026-11'), { k: '2026-11' })
  assert.equal(calls, 1)
  assert.deepEqual(c.peek('2026-11'), { k: '2026-11' })
  assert.equal(c.peek('2026-12'), null)
  await c.get('2026-12')
  assert.equal(calls, 2, 'another month is another fetch')
})

test('a month is fetched again after five minutes, not before', async () => {
  const t = clock()
  let calls = 0
  const c = createCalendarCache(async () => ++calls, { now: t.now })
  await c.get('2026-11')
  t.advance(CALENDAR_CACHE_MS - 1)
  assert.equal(c.peek('2026-11'), 1)
  await c.get('2026-11')
  assert.equal(calls, 1)
  t.advance(2)
  assert.equal(c.peek('2026-11'), null)
  assert.equal(await c.get('2026-11'), 2)
})

test('asking twice at once shares one request', async () => {
  let calls = 0
  let release
  const gate = new Promise(r => { release = r })
  const c = createCalendarCache(async () => { calls++; await gate; return 'data' }, { now: clock().now })
  const [a, b] = [c.get('2026-11'), c.get('2026-11')]
  release()
  assert.deepEqual(await Promise.all([a, b]), ['data', 'data'])
  assert.equal(calls, 1)
})

test('a failure is not remembered: the next ask tries again, and the pending request is not stuck', async () => {
  let calls = 0
  const c = createCalendarCache(async () => { calls++; if (calls === 1) throw new Error('down'); return 'ok' }, { now: clock().now })
  await assert.rejects(c.get('2026-11'), /down/)
  assert.equal(c.peek('2026-11'), null)
  assert.equal(await c.get('2026-11'), 'ok')
  assert.equal(calls, 2)
})

test('"try again" forces a fresh fetch, and clear() forgets everything', async () => {
  let calls = 0
  const c = createCalendarCache(async () => ++calls, { now: clock().now })
  await c.get('2026-11')
  assert.equal(await c.get('2026-11', { force: true }), 2)
  assert.equal(c.peek('2026-11'), 2)
  c.clear()
  assert.equal(c.peek('2026-11'), null)
})

// ---------- wiring that has no DOM test ----------

const read = (f) => lf(fs.readFileSync(f, 'utf8'))

test('the calendar is mounted once, only for people who may see the toolbox, and loads on demand', () => {
  assert.ok(read('src/App.jsx').includes('<CalendarHost />'))
  const host = read('src/components/CalendarHost.jsx')
  assert.ok(host.includes('canSeeApps(profile)'), 'same people as the toolbox')
  assert.ok(host.includes('if (!allowed || !open) return null'))
  assert.ok(host.includes('OPEN_CALENDAR_EVENT'))
  assert.ok(read('src/lib/lazyParts.js').includes("export const CalendarPanel = lazyWithPreload(() => import('../components/CalendarPanel'))"))
  assert.ok(!/import .* from '\.\/CalendarPanel'/.test(host), 'not part of the first download')
})

test('closing a pinned calendar unpins it, and a pinned one is open when the app starts', () => {
  const host = read('src/components/CalendarHost.jsx')
  assert.match(host, /const close = useCallback\(\(\) => \{\n\s+setOpen\(false\)\n\s+setPinned\(false\)\n\s+writePinned\(storage\(\), false\)/)
  assert.ok(host.includes('useState(pinned)'), 'open at start when pinned')
})

test('a pinned calendar ignores Escape and an outside click; a popup does not', () => {
  const panel = read('src/components/CalendarPanel.jsx')
  assert.ok(panel.includes('if (pinned) return'), 'no outside-close listeners while pinned')
  assert.ok(panel.includes("e.key === 'Escape'"))
  assert.ok(panel.includes('mousedown'))
  assert.ok(panel.includes('aria-pressed={pinned}'))
})

test('the widget asks the Worker for the month with the person\'s own token', () => {
  const api = read('src/lib/dtrCalendarApi.js')
  assert.ok(api.includes('/dtr/calendar?month='))
  assert.ok(api.includes('Authorization: `Bearer ${token}`'))
  assert.ok(api.includes('VITE_GIFS_WORKER_URL'), 'the same Worker as the GIFs and TURN')
  assert.ok(read('workers/src/index.js').includes("url.pathname === '/dtr/calendar' && request.method === 'GET'"))
})

test('the event name is shared between the toolbox and the host', () => {
  assert.equal(OPEN_CALENDAR_EVENT, 'punx:calendar')
})
