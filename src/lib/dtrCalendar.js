// The calendar widget's logic: which days a month grid shows, what lands on each day,
// how it is worded, whether it is pinned open, and a small cache of the months already
// fetched. No DOM and no Firebase in here, so all of it is tested.
//
// The DATA is the DTR app's company calendar (holidays and approved leave), handed
// over by the Worker route GET /dtr/calendar (workers/src/routes/dtrCalendar.js).
// The rules for what a day shows are the DTR's own (its src/services/calendar.js):
// a holiday that spans days is on every one of them; day-based leave covers only
// weekdays, so a Friday to Monday sick leave does not paint the weekend; an offset
// claims its one date.
//
// Months are "YYYY-MM" strings with a 1-based month everywhere here, the same as the
// Worker, so there is no 0-based/1-based conversion to get wrong.

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const LEAVE_TYPES = {
  sick: { label: 'Sick leave', tag: 'SL' },
  vacation: { label: 'Vacation leave', tag: 'VL' },
  offset: { label: 'Offset', tag: 'OFFSET' },
}
export const HOLIDAY_TYPES = {
  regular: { label: 'Regular holiday' },
  special: { label: 'Special non-working day' },
  company: { label: 'Company holiday' },
}

/** Sent on window to open the calendar from somewhere other than itself (the toolbox). */
export const OPEN_CALENDAR_EVENT = 'punx:calendar'

export const MAX_HOLIDAY_DAYS = 31 // the Worker's rule too: a typo'd end date cannot paint a year

const pad = (n) => String(n).padStart(2, '0')

/** Local `YYYY-MM-DD`. Never toISOString: that is UTC and lands on the wrong day east of it. */
export const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** `YYYY-MM-DD` as a local-midnight Date, or null (also for 2026-02-31, which Date would roll over). */
export function parseYMD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return toYMD(d) === s ? d : null
}

/** "2026-11" -> { year: 2026, month: 11 }, or null. */
export function parseMonthKey(key) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(typeof key === 'string' ? key : '')
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null
}

export const monthKey = ({ year, month }) => `${year}-${pad(month)}`
export const monthKeyOf = (date) => monthKey({ year: date.getFullYear(), month: date.getMonth() + 1 })

/** Step a month key by n months, rolling the year: ('2026-12', 1) -> '2027-01'. */
export function addMonths(key, n) {
  const p = parseMonthKey(key)
  if (!p) return key
  const d = new Date(p.year, p.month - 1 + n, 1)
  return monthKeyOf(d)
}

/** "November 2026". */
export function monthTitle(key) {
  const p = parseMonthKey(key)
  return p ? `${MONTH_NAMES[p.month - 1]} ${p.year}` : ''
}

/**
 * The cells of a month grid, Sunday-first, padded with the neighbouring months' days
 * so every row is a whole week: [{ ymd, day, inMonth }]. Four to six rows. The
 * Worker fetches exactly this range (its gridRange), so the padding days have their
 * events too.
 */
export function monthGrid(key) {
  const p = parseMonthKey(key)
  if (!p) return []
  const first = new Date(p.year, p.month - 1, 1)
  const last = new Date(p.year, p.month, 0)
  const cursor = new Date(p.year, p.month - 1, 1 - first.getDay())
  const cells = []
  while (cells.length % 7 !== 0 || cursor <= last) {
    cells.push({ ymd: toYMD(cursor), day: cursor.getDate(), inMonth: cursor.getMonth() === p.month - 1 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return cells
}

const addDays = (ymd, n) => {
  const d = parseYMD(ymd)
  d.setDate(d.getDate() + n)
  return toYMD(d)
}

/**
 * { 'YYYY-MM-DD': [holiday, ...] }: a multi-day holiday is listed on EVERY day it
 * covers, each copy carrying `day` and `days` (so a chip can say "2/3"). Two holidays
 * can share a date. Anything with an unreadable date is skipped.
 */
export function holidaysByDate(holidays = []) {
  const map = {}
  for (const h of holidays) {
    const start = parseYMD(h?.date)
    if (!start) continue
    const end = parseYMD(h.endDate) || start
    const span = end < start ? 1 : Math.round((end - start) / 86400000) + 1
    const n = Math.min(span, MAX_HOLIDAY_DAYS)
    for (let i = 0; i < n; i++) (map[i === 0 ? h.date : addDays(h.date, i)] ||= []).push({ ...h, day: i + 1, days: n })
  }
  return map
}

const isWeekday = (d) => d.getDay() !== 0 && d.getDay() !== 6

/**
 * Who is on leave on a day. Inside the leave's range, and, for day-based leave, only
 * on a weekday; an offset claims its date whatever day it is. Same rule as the DTR.
 */
export function leavesOnDate(leaves = [], ymd) {
  const date = parseYMD(ymd)
  if (!date) return []
  return leaves.filter(l => ymd >= l.startDate && ymd <= l.endDate && (l.type === 'offset' || isWeekday(date)))
}

/** Everything on one day: its holidays and who is on leave. */
export function eventsForDate(ymd, { holidayIndex = {}, leaves = [] } = {}) {
  return { holidays: holidayIndex[ymd] || [], leaves: leavesOnDate(leaves, ymd) }
}

/** "Ana Reyes" plus a short tag: "Ana Reyes · SL", or "Ben · OFFSET 4h" when hours are known. */
export function leaveLine(l) {
  const t = LEAVE_TYPES[l.type]
  const tag = t ? t.tag : String(l.type)
  const hours = l.type === 'offset' && Number(l.hours) > 0 ? ` ${Number(l.hours)}h` : ''
  return `${l.userName} · ${tag}${hours}`
}

/** "Tue, Nov 10" for a day; '' for anything unreadable. */
export function dayLabel(ymd) {
  const d = parseYMD(ymd)
  return d ? `${WEEKDAY_LABELS[d.getDay()]}, ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}` : ''
}

/** Up to `max` upcoming holidays from `today` on, for a short list. */
export function upcomingHolidays(holidays = [], today, max = 3) {
  return holidays.filter(h => (h.endDate || h.date) >= today).slice().sort((a, b) => a.date.localeCompare(b.date)).slice(0, max)
}

// ---------- pinned open ----------

export const PINNED_KEY = 'punx.calendarPinned'

/** Was the calendar left pinned open on this device? Storage that throws counts as "no". */
export function readPinned(storage) {
  try { return storage?.getItem(PINNED_KEY) === '1' } catch { return false }
}

export function writePinned(storage, pinned) {
  try {
    if (pinned) storage?.setItem(PINNED_KEY, '1')
    else storage?.removeItem(PINNED_KEY)
  } catch { /* private mode: the pin lasts until the tab closes, which is acceptable */ }
}

// ---------- what a failure says ----------

/**
 * Plain words for a failed load. `status` is the Worker's HTTP status, or 0 for no
 * answer at all. 401 and 403 are the same message because both mean "not for this
 * account here", and neither is something retrying fixes.
 */
export function describeCalendarFailure(status) {
  if (status === 401 || status === 403) return { retryable: false, message: "The calendar isn't available to your account." }
  if (status === 0) return { retryable: true, message: "Couldn't reach the calendar. Check your connection and try again." }
  if (status === 400) return { retryable: false, message: "Couldn't load that month." }
  return { retryable: true, message: "Couldn't load the calendar right now. Try again in a moment." }
}

// ---------- the months already fetched ----------

export const CALENDAR_CACHE_MS = 5 * 60 * 1000

/**
 * Remembers each month for a few minutes, so paging back and forth does not refetch,
 * and asking for a month that is already on its way shares that request. A failure is
 * never remembered, so the next ask tries again. `fetchMonth(key)` does the work.
 */
export function createCalendarCache(fetchMonth, { now = Date.now, ttl = CALENDAR_CACHE_MS } = {}) {
  const done = new Map() // key -> { at, data }
  const pending = new Map() // key -> Promise
  return {
    peek(key) {
      const hit = done.get(key)
      return hit && now() - hit.at < ttl ? hit.data : null
    },
    async get(key, { force = false } = {}) {
      if (!force) {
        const hit = this.peek(key)
        if (hit) return hit
        if (pending.has(key)) return pending.get(key)
      }
      const p = (async () => {
        try {
          const data = await fetchMonth(key)
          done.set(key, { at: now(), data })
          return data
        } finally {
          pending.delete(key)
        }
      })()
      pending.set(key, p)
      return p
    },
    clear() { done.clear() },
  }
}
