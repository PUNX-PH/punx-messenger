// A short custom status next to your name ("On leave", "In a meeting"), optionally clearing by
// itself. Pure, so it is tested.
//
// Stored on the person's own profile as `status: { text, until }`: `until` is a time in
// milliseconds, or null for "until I change it". Expiry is decided where it is SHOWN (a
// status whose time has passed is simply not displayed), so nothing has to run to clear it.
//
// Everything read from somebody else's profile is cleaned again here, not trusted: the rules
// let a person write any text into their own profile, so a status can arrive too long, with
// control characters, as the wrong type, or with text-direction tricks in it.

export const STATUS_MAX = 60

/** Ready-made statuses, for one click. */
export const STATUS_PRESETS = ['In a meeting', 'On leave', 'Out sick', 'Working remotely', 'Heads down']

/** How long a status stays: the ids are what the dialog's choices are called. */
export const EXPIRY_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: '1h', label: '1 hour' },
  { id: '4h', label: '4 hours' },
  { id: '7d', label: '7 days' },
  { id: 'never', label: "Don't clear" },
]

const HOUR = 60 * 60 * 1000

// Control characters, and the marks that make text run right-to-left or flip around it.
const UNWANTED = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

/** Text for a status: one line, no control or direction characters, at most STATUS_MAX characters. '' if nothing is left. */
export function cleanStatusText(raw) {
  if (typeof raw !== 'string') return ''
  const flat = raw.replace(UNWANTED, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(flat).slice(0, STATUS_MAX).join('').trim()
}

/** When a status with this choice of expiry ends: a time in ms, or null for never. */
export function expiryAt(id, now = Date.now()) {
  switch (id) {
    case '1h': return now + HOUR
    case '4h': return now + 4 * HOUR
    case '7d': return now + 7 * 24 * HOUR
    case 'today': {
      const end = new Date(now)
      end.setHours(23, 59, 59, 999) // the end of the person's own day
      return end.getTime()
    }
    default: return null // 'never', and anything unknown
  }
}

/** What to store for the text and expiry the person chose, or null when there is nothing to store (clear it). */
export function buildStatus(text, expiryId, now = Date.now()) {
  const clean = cleanStatusText(text)
  return clean ? { text: clean, until: expiryAt(expiryId, now) } : null
}

/**
 * The status to SHOW for someone: { text, until }, or null when they have none, it has
 * expired, or what is stored is not usable. Safe to call on anybody's profile.
 */
export function statusOf(user, now = Date.now()) {
  const s = user?.status
  // Not an object (or nothing there): no status. An array has no `text`, so it falls out below.
  if (!s || typeof s !== 'object') return null
  const text = cleanStatusText(s.text)
  if (!text) return null
  const until = typeof s.until === 'number' && Number.isFinite(s.until) ? s.until : null
  if (until !== null && until <= now) return null
  return { text, until }
}
