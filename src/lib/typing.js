// Who is typing right now, and when that will next change.
//
// A typing entry is a timestamp the other person's client rewrites every few
// seconds while they type; it counts for TYPING_TTL_MS after the last write.
//
// This used to be answered by a timer that ticked every two seconds in EVERY
// open conversation, re-rendering the whole message list each time to find out
// that nobody was typing. Knowing when the answer will next change (`expiresIn`)
// lets the caller sleep until then instead.

export const TYPING_TTL_MS = 6000

/**
 * @param {Record<string, {toMillis?: () => number}>|undefined} typing uid → last write
 * @param {string|undefined} meUid never counted: you know you are typing
 * @param {number} now
 * @returns {{ uids: string[], expiresIn: number|null }} `expiresIn` is the
 *   milliseconds until the first of `uids` stops counting, or null when there is
 *   no one, i.e. nothing to wait for.
 */
export function whoIsTyping(typing, meUid, now) {
  const uids = []
  let expiresIn = null
  for (const [uid, ts] of Object.entries(typing || {})) {
    if (uid === meUid) continue
    const ms = ts?.toMillis?.() ?? 0
    // No time yet: a write still waiting for the server's clock. Not typing.
    if (!ms) continue
    const left = ms + TYPING_TTL_MS - now
    if (left <= 0) continue
    uids.push(uid)
    if (expiresIn === null || left < expiresIn) expiresIn = left
  }
  return { uids, expiresIn }
}
