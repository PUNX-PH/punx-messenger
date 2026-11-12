// Fetches one month of the DTR company calendar from the Worker (GET /dtr/calendar,
// workers/src/routes/dtrCalendar.js) with the person's own ID token, the same way the
// GIF picker and the TURN credentials do. The decisions (what a failure says, how long
// a month is remembered) are in dtrCalendar.js, where they are tested.
import { auth } from './firebase'
import { createCalendarCache, describeCalendarFailure } from './dtrCalendar'

const WORKER_API_URL = import.meta.env.VITE_GIFS_WORKER_URL || 'http://127.0.0.1:8787'

/** A failed load, carrying the words to show and whether trying again can help. */
export class CalendarLoadError extends Error {
  constructor(status) {
    const { message, retryable } = describeCalendarFailure(status)
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

async function fetchMonth(key) {
  const user = auth.currentUser
  if (!user) throw new CalendarLoadError(401)
  let res
  try {
    const token = await user.getIdToken()
    res = await fetch(`${WORKER_API_URL}/dtr/calendar?month=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new CalendarLoadError(0) // offline, blocked, or the Worker is unreachable
  }
  if (!res.ok) throw new CalendarLoadError(res.status)
  try {
    return await res.json()
  } catch {
    throw new CalendarLoadError(502)
  }
}

export const calendarCache = createCalendarCache(fetchMonth)
