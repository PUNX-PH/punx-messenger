// Do not disturb: a switch on your own profile that silences the pings and the desktop
// notifications, for a while or until you turn it off. Pure, so it is tested.
//
// Stored on the person's own profile as `dnd: { until }`: `until` is a time in
// milliseconds, or null for "until I turn it off". Like a status, the end is decided
// where it is USED (a time that has passed simply means it is off), so nothing has to
// run to switch it off.
//
// It is quiet, not blocked: messages still arrive, unread badges still count (that is
// what muting a conversation is for), and a call still rings. It only stops the sound
// and the system notification, for DMs and for @mentions alike.

import { headerTime } from './timeFormat.js'

/** How long it lasts: the ids are what the menu's choices are called. */
export const DND_OPTIONS = [
  { id: '30m', label: '30 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '4h', label: '4 hours' },
  { id: 'morning', label: 'Until 8:00 in the morning' },
  { id: 'never', label: 'Until I turn it off' },
]

/** The hour "the morning" means. */
export const MORNING_HOUR = 8

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/** When do-not-disturb with this choice ends: a time in ms, or null for "until I turn it off". */
export function dndUntil(id, now = Date.now()) {
  switch (id) {
    case '30m': return now + 30 * MINUTE
    case '1h': return now + HOUR
    case '4h': return now + 4 * HOUR
    case 'morning': {
      // The next 8:00 by the person's own clock: this morning if it is not 8 yet, else tomorrow.
      const t = new Date(now)
      t.setHours(MORNING_HOUR, 0, 0, 0)
      if (t.getTime() <= now) t.setDate(t.getDate() + 1)
      return t.getTime()
    }
    default: return null // 'never', and anything unknown
  }
}

/** What to store for a choice. */
export const buildDnd = (id, now = Date.now()) => ({ until: dndUntil(id, now) })

/**
 * Is do-not-disturb on for this person right now? Returns { until } (null = until they turn
 * it off), or null when it is off, has run out, or what is stored is not usable.
 * `until` has to be a number or an explicit null: a field that is missing or the wrong
 * type is never read as "on for ever".
 */
export function dndOf(user, now = Date.now()) {
  // Anything that is not an object has no `until` to read, so it falls out as off below.
  const until = user?.dnd?.until
  if (until === null) return { until: null }
  // Number.isFinite does not convert: text, NaN and Infinity are all refused.
  if (Number.isFinite(until) && until > now) return { until }
  return null
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * How long it has left, in words: "until 3:40 PM", "until tomorrow 8:00 AM", "until you turn it off".
 * `format` is the person's clock choice (see timeFormat.js).
 */
export function dndLabel(dnd, now = Date.now(), format = 'auto', locale = []) {
  if (!dnd) return ''
  if (dnd.until === null) return 'until you turn it off'
  const end = new Date(dnd.until)
  const time = headerTime(end, format, locale)
  const today = new Date(now)
  if (sameDay(end, today)) return `until ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay(end, tomorrow)) return `until tomorrow ${time}`
  return `until ${end.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

/**
 * What to do when something new arrives for you: play the ping, show a system notification.
 * Do-not-disturb turns off both. Otherwise the ping plays unless you are looking at that very
 * conversation, and the notification shows only when it is allowed and you are away from the tab.
 */
export function announcePlan({ dnd = false, sound = false, looking = false, canNotify = false } = {}) {
  if (dnd) return { ping: false, notify: false }
  return { ping: !!sound && !looking, notify: !!canNotify }
}
