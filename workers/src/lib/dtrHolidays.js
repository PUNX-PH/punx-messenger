// VENDORED from the DTR app: punx-dtr-tracker, src/services/holidays.js, as of its
// commit 279ed7d3 (2026-11). Only the import line is replaced (by the two date helpers
// it used, copied from the DTR's leave.js); everything after them is the DTR's own
// code, so the calendar the messenger shows is built by the SAME rules as the one in
// the DTR: built-in Philippine holidays, plus HR's edits, hides, multi-day and
// repeating holidays.
//
// KEEP IN SYNC BY HAND. If the holiday rules change in the DTR app, copy the new file
// here (keeping the helper block) and update the commit above. The tests in
// workers/test/dtr-calendar.test.mjs pin the output for known years, so a copy that
// drifts from what they expect fails there.
//
// The DTR's original header follows.

// Philippine + company holidays. Pure, so it runs in plain node
// (tests/calendar.test.mjs) and the calendar, attendance and DTR can all ask the
// same question: "is this date a holiday?"
//
// WHERE THE LIST COMES FROM
//   1. phHolidays(year) — the holidays that are fixed by law or fall out of a
//      rule (Easter, "last Monday of August"). Generated, so it never goes stale
//      and nobody has to remember to add next year.
//   2. EXTRA_PH — the ones that do NOT follow a rule and are set by proclamation
//      each year (Chinese New Year, Eid). Only years we are sure of are listed.
//   3. Firestore `holidays/*` — what HR adds, edits and hides. This is the part
//      that matters in practice: a late proclamation is a two-minute edit, not a
//      code push. See mergeHolidays().
//
// This is a STARTING list. The government decides each year's holidays by
// proclamation (and moves some), so HR should check it against the official
// one — the portal lets them correct any entry.

// ---- date helpers (from the DTR's leave.js) ----
const pad2 = (n) => String(n).padStart(2, '0')

/** Local `YYYY-MM-DD`. Never toISOString — that is UTC and lands on the wrong day east of it. */
export const toYMD = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

/** `YYYY-MM-DD` -> a LOCAL midnight Date. `new Date('2026-09-10')` is UTC and is the off-by-one to avoid. */
export function parseYMD(str) {
    if (typeof str !== 'string') return null
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    // Rejects 2026-02-31, which Date would silently roll into March.
    return toYMD(d) === str ? d : null
}
// ---- end of helpers ----

export const HOLIDAY_TYPES = {
    // Hues chosen so no holiday shares one with a leave type (sick red, vacation
    // blue, offset purple — see LEAVE_TYPES), or the legend and chips are ambiguous.
    regular: { label: 'Regular Holiday', short: 'Regular', color: 'var(--accent-teal)' },
    special: { label: 'Special Non-Working Day', short: 'Special', color: 'var(--accent-amber)' },
    company: { label: 'Company Holiday', short: 'Company', color: 'var(--accent-pink)' },
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

/** Easter Sunday (Gregorian), the anonymous Meeus/Jones/Butcher algorithm. */
export function easterSunday(year) {
    const a = year % 19
    const b = Math.floor(year / 100)
    const c = year % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(year, month - 1, day)
}

const shift = (date, days) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    return d
}

/** Last Monday of a month (National Heroes Day is the last Monday of August). */
function lastMonday(year, month) {
    const d = new Date(year, month, 0) // last day of `month` (1-based)
    while (d.getDay() !== 1) d.setDate(d.getDate() - 1)
    return d
}

// Holidays that follow no rule — proclaimed year by year. Listed only where the
// date is certain. Eid'l Fitr and Eid'l Adha are deliberately NOT here: they
// depend on the moon sighting and are proclaimed days before, so HR adds them.
const EXTRA_PH = {
    2026: [
        { date: '2026-02-17', name: 'Chinese New Year', type: 'special' },
    ],
    2027: [
        { date: '2027-02-06', name: 'Chinese New Year', type: 'special' },
    ],
}

/** The built-in Philippine holidays for one year: [{ id, date, name, type, source:'ph' }]. */
export function phHolidays(year) {
    const easter = easterSunday(year)
    const list = [
        { date: ymd(year, 1, 1), name: "New Year's Day", type: 'regular' },
        { date: toYMD(shift(easter, -3)), name: 'Maundy Thursday', type: 'regular' },
        { date: toYMD(shift(easter, -2)), name: 'Good Friday', type: 'regular' },
        { date: toYMD(shift(easter, -1)), name: 'Black Saturday', type: 'special' },
        { date: ymd(year, 4, 9), name: 'Araw ng Kagitingan', type: 'regular' },
        { date: ymd(year, 5, 1), name: 'Labor Day', type: 'regular' },
        { date: ymd(year, 6, 12), name: 'Independence Day', type: 'regular' },
        { date: ymd(year, 8, 21), name: 'Ninoy Aquino Day', type: 'special' },
        { date: toYMD(lastMonday(year, 8)), name: 'National Heroes Day', type: 'regular' },
        { date: ymd(year, 11, 1), name: "All Saints' Day", type: 'special' },
        { date: ymd(year, 11, 30), name: 'Bonifacio Day', type: 'regular' },
        { date: ymd(year, 12, 8), name: 'Feast of the Immaculate Conception', type: 'special' },
        { date: ymd(year, 12, 24), name: 'Christmas Eve', type: 'special' },
        { date: ymd(year, 12, 25), name: 'Christmas Day', type: 'regular' },
        { date: ymd(year, 12, 30), name: 'Rizal Day', type: 'regular' },
        { date: ymd(year, 12, 31), name: 'Last Day of the Year', type: 'special' },
        ...(EXTRA_PH[year] || []),
    ]
    return list
        .map(h => ({ ...h, id: `ph-${h.date}`, source: 'ph' }))
        .sort((a, b) => a.date.localeCompare(b.date))
}

// A holiday can last several days (Holy Week, a company break). Capped so a typo'd
// end year can't paint half the calendar.
export const MAX_SPAN_DAYS = 31

const addDays = (ymdStr, n) => {
    const d = parseYMD(ymdStr)
    d.setDate(d.getDate() + n)
    return toYMD(d)
}

/** How many calendar days a holiday covers, start and end inclusive (1 for a single day). */
export function spanDays(date, endDate) {
    const start = parseYMD(date)
    const end = parseYMD(endDate)
    if (!start || !end || end < start) return 1
    return Math.round((end - start) / 86400000) + 1
}

const daysInMonth = (y, m) => new Date(y, m, 0).getDate() // m is 1-based

/**
 * The occurrences of one stored holiday doc: [{ date, endDate }].
 *
 * A RECURRING doc repeats on the same month and day every year from the year it
 * starts, keeping its length (a Dec 30 – Jan 2 break stays four days). It never
 * appears before its first year. A 29 Feb holiday falls on 28 Feb in a year with
 * no 29th. Built-in overrides (ids starting ph-) are tied to one year's date and
 * never repeat — the built-in list already generates every year itself.
 */
function occurrences(doc, years) {
    const length = Math.min(spanDays(doc.date, doc.endDate), MAX_SPAN_DAYS)
    const startYear = Number(doc.date.slice(0, 4))
    const recurring = doc.recurring === true && !doc.id.startsWith('ph-') && years.length > 0
    if (!recurring) {
        return [{ date: doc.date, endDate: length > 1 ? addDays(doc.date, length - 1) : doc.date }]
    }
    const [, m, d] = doc.date.split('-').map(Number)
    return years.filter(y => y >= startYear).map(y => {
        const date = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, '0')}`
        return { date, endDate: length > 1 ? addDays(date, length - 1) : date }
    })
}

/**
 * Built-in list + what HR has stored in Firestore, for the given `years`.
 *
 * A stored doc whose id starts `ph-` is an OVERRIDE of the built-in holiday with
 * that id: it replaces the name/type/date (and may stretch it over several days),
 * or — with `hidden: true` — removes it (HR deleting a holiday that was not
 * proclaimed this year). Anything else is a company holiday HR added, which may
 * span days and may repeat every year. Hiding is a flag rather than a delete so
 * the built-in list cannot grow it back the next time the page loads.
 *
 * Each result: { id, seriesId, date, endDate, days, name, type, source, recurring }.
 * `id` is unique per occurrence (`<doc id>@<year>` for a repeating holiday);
 * `seriesId` is the stored doc, which is what editing or removing acts on.
 */
export function mergeHolidays(builtIn, stored = [], years = []) {
    const out = new Map(builtIn.map(h => [h.id, { ...h, seriesId: h.id, endDate: h.date, days: 1, recurring: false }]))
    for (const doc of stored) {
        if (!doc || !doc.id) continue
        if (doc.hidden === true) { out.delete(doc.id); continue }
        if (!parseYMD(doc.date) || !HOLIDAY_TYPES[doc.type]) continue // ignore a malformed doc rather than crash the calendar
        const isOverride = doc.id.startsWith('ph-')
        const repeats = doc.recurring === true && !isOverride
        if (isOverride) out.delete(doc.id)
        for (const occ of occurrences(doc, years)) {
            const id = repeats && years.length > 0 ? `${doc.id}@${occ.date.slice(0, 4)}` : doc.id
            out.set(id, {
                id, seriesId: doc.id, date: occ.date, endDate: occ.endDate, days: spanDays(occ.date, occ.endDate),
                name: doc.name || 'Holiday', type: doc.type, recurring: repeats,
                source: isOverride ? 'ph-edited' : 'company',
            })
        }
    }
    return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

/** Every built-in holiday across the years a view spans, merged with HR's edits. */
export function holidaysForYears(years, stored = []) {
    const ys = [...new Set(years)]
    return mergeHolidays(ys.flatMap(phHolidays), stored, ys)
}

/**
 * { 'YYYY-MM-DD': [holiday, ...] } — a multi-day holiday is listed on EVERY day
 * it covers, each copy carrying `day` (1-based) and `days` so a chip can say
 * "2/3". Two holidays can share a date.
 */
export function holidaysByDate(list) {
    const map = {}
    for (const h of list) {
        const n = Math.min(spanDays(h.date, h.endDate), MAX_SPAN_DAYS)
        for (let i = 0; i < n; i++) (map[i === 0 ? h.date : addDays(h.date, i)] ||= []).push({ ...h, day: i + 1, days: n })
    }
    return map
}
