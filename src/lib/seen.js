// "Seen" in direct messages: under your latest message that the other person has read, a line
// like "Seen 3:41 PM". Pure, so it is tested.
//
// Where it comes from. When someone actually has a DM open and on screen, the app records the
// time on their own profile as `seen.<dm key>` (a server time). The other person's app reads that
// one field from their profile while the DM is open.
//
// It is NOT built on `lastRead`, which is also written by "Mark as read" and "Mark all as read":
// using it would tell a sender "Seen" for something its reader never opened. `seen` is written only
// by the open conversation, and only when there is something newer in it than the last time.
//
// It is a choice, and it is shared both ways: with "Let others see when I've read their messages"
// off (Preferences), nothing is written, and the line is not shown to you either. It is also only
// for DMs: a channel with many people would be a different thing.
//
// Honest limit: `lastRead` has always been readable by everyone signed in (the profile is the
// directory), so this switch controls what the app writes and shows, not what a determined person
// with the database could infer from `lastRead`.

import { headerTime } from './timeFormat.js'
import { needsMarkRead } from './unread.js'

/** Is this the path of a direct message conversation ("dms/<id>"), with or without a trailing /messages? */
export const isDmPath = (path) => typeof path === 'string' && /^dms\/[^/]+(\/messages)?$/.test(path)

/**
 * When the person last had that conversation open, in milliseconds, from their profile; null when
 * they never have, or what is stored is not a usable time. `key` is the read key of the DM.
 */
export function seenAtOf(user, key) {
  // Whatever is stored is only used if it ends up as a real time: Number.isFinite does not convert,
  // so text, NaN, Infinity, a function or an object (a key like "constructor") all read as nothing.
  const v = user?.seen?.[key]
  const ms = typeof v?.toMillis === 'function' ? v.toMillis() : v
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/**
 * What the open conversation should write: `read` (the unread bookkeeping, as always) and `seen`
 * (the receipt). `seen` only for a DM, only when sharing is on, and only when there is something
 * newer than the last receipt: so opening a conversation that was already "marked as read" still
 * records that it was opened, and re-opening it with nothing new writes nothing.
 */
export function marksNeeded({ containerPath, newestCreatedAt, lastRead, seen, share }) {
  return {
    read: needsMarkRead(newestCreatedAt, lastRead),
    seen: !!share && isDmPath(containerPath) && needsMarkRead(newestCreatedAt, seen),
  }
}

/**
 * Which message to put the line under: your latest message that was sent at or before the time
 * the other person last had the chat open. Null when none has been seen (or nobody has opened it).
 * `messages` are oldest first. A message of yours with no time yet (still being sent) is not seen.
 */
export function seenMarker(messages, meUid, seenAt) {
  if (!meUid || !Number.isFinite(seenAt) || !Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.author?.uid !== meUid) continue
    // No time yet (still being sent) is undefined, and undefined <= anything is false: not seen.
    const at = m.createdAt?.toMillis?.()
    if (at <= seenAt) return { id: m.id, at: seenAt }
  }
  return null
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "Seen 3:41 PM" for today, "Seen Nov 12, 3:41 PM" for another day. `format` is the clock choice (timeFormat.js). */
export function seenLabel(at, now = Date.now(), format = 'auto', locale = []) {
  if (!Number.isFinite(at) || !(at > 0)) return ''
  const when = new Date(at)
  const time = headerTime(when, format, locale)
  if (sameDay(when, new Date(now))) return `Seen ${time}`
  return `Seen ${when.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}, ${time}`
}
