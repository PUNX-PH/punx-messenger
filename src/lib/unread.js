// What counts as unread, kept apart from Firebase so it can be tested on its own.
//
// "Unread" is a comparison: a conversation's last message time against the time
// this person last read it. These few functions used to live in db.js; they moved
// here unchanged (db.js still exports them) so the browser-tab counter can use
// them without pulling in the database.

// Deterministic DM convo id from two uids
export const dmConvoId = (a, b) => [a, b].sort().join('__')

// Encode a container path into a safe Firestore map key.
// "dms/xxx" -> "dms__xxx"; "groups/xxx/channels/yyy" -> "groups__xxx__channels__yyy"
export const pathToReadKey = (containerPath) => containerPath.replace(/\//g, '__')

// Compare lastMessageAt with lastRead → unread? Either may be a Firestore Timestamp.
export const isUnread = (lastMessageAt, lastReadAt) => {
  if (!lastMessageAt) return false
  const m = lastMessageAt.toMillis?.() ?? 0
  const r = lastReadAt?.toMillis?.() ?? 0
  return m > r
}

/**
 * Is there anything to mark as read? False only when the person's last-read time is
 * already at or past the newest message's time, so coming back to a tab where
 * nothing has happened does not write to the database (and wake every other
 * client's listener) for nothing. When the newest message has no time yet (still
 * being sent) or there are no messages, it answers true, as before.
 */
export function needsMarkRead(newestCreatedAt, lastReadAt) {
  const newest = newestCreatedAt?.toMillis?.()
  if (!newest) return true
  return (lastReadAt?.toMillis?.() ?? 0) < newest
}

/**
 * The read key of the conversation a route shows, or null for a page that is not
 * one (the DM list, notes, settings). Same keys as pathToReadKey of the
 * conversation's container path.
 */
export function readKeyForRoute(pathname, meUid) {
  let m = /^\/dms\/([^/]+)\/?$/.exec(pathname || '')
  if (m) return meUid ? pathToReadKey(`dms/${dmConvoId(meUid, m[1])}`) : null
  m = /^\/g\/([^/]+)\/c\/([^/]+)\/?$/.exec(pathname || '')
  if (m) return pathToReadKey(`groups/${m[1]}/channels/${m[2]}`)
  return null
}

/**
 * How many conversations have something new in them.
 *
 * Conversations, not messages: all a conversation records is when its last message
 * arrived. Muted groups do not count (they do not badge in the sidebar either).
 * `lookingAt` is the read key of the conversation on screen while the person is
 * actually looking at it: it is being read right now, so it is left out.
 *
 * A DM whose last message is the person's own does not count: that is them
 * writing from another device, not something waiting for them. (Channels do not
 * record who wrote last, so for those it cannot be told.)
 */
export function countUnread({
  dmConvos = [], channelsByGroup = {}, lastRead = {}, mutedGroups = new Set(), meUid, lookingAt = null,
}) {
  let n = 0
  for (const dm of dmConvos) {
    const key = pathToReadKey(`dms/${dm.id}`)
    if (key === lookingAt) continue
    // A conversation that was only opened has a time but no message and no author.
    if (!dm.lastMessageAuthorUid || dm.lastMessageAuthorUid === meUid) continue
    if (isUnread(dm.lastMessageAt, lastRead[key])) n++
  }
  for (const [groupId, channels] of Object.entries(channelsByGroup)) {
    if (mutedGroups.has(groupId)) continue
    for (const c of channels || []) {
      const key = pathToReadKey(`groups/${groupId}/channels/${c.id}`)
      if (key === lookingAt) continue
      if (isUnread(c.lastMessageAt, lastRead[key])) n++
    }
  }
  return n
}

/** "(3) Punx Messenger"; nothing added when there is nothing new. */
export function titleWithCount(base, n) {
  if (!n || n < 1) return base
  return `(${n > 99 ? '99+' : n}) ${base}`
}
