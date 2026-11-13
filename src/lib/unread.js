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
 * Where the "New" line goes when a conversation is opened: the id of the first message
 * you have not read, or null when there is nowhere meaningful to put one.
 *   - Never read before (no last-read time): null. A new member of a channel with years of
 *     history is not told it is all "new".
 *   - Your own messages are never "new" to you, so the line goes above the first unread
 *     message from someone else.
 *   - The very first loaded message is already unread: null. Older ones may be unread
 *     too, so a line above this one would say "from here" when it is not.
 *   - A message still waiting for its server time has no createdAt, and is skipped.
 * `messages` are oldest first, as the list has them.
 */
export function firstUnreadId(messages, lastReadAt, meUid) {
  const read = lastReadAt?.toMillis?.()
  const list = messages || []
  const i = list.findIndex(m => {
    const at = m?.createdAt?.toMillis?.()
    return at > read && m.author?.uid !== meUid
  })
  return i > 0 ? list[i].id : null
}

/**
 * Is the "New" line scrolled out of sight ABOVE the visible part of the list? Then a
 * button can take the reader back to it. Below the view (they are reading older
 * messages and will reach it) or in view, no button. Both numbers are screen positions
 * in pixels: the line's bottom edge and the list's top edge. Anything unmeasurable
 * answers false, so a layout that has not happened yet never shows the button.
 */
export function newLineIsAbove(lineBottom, viewTop) {
  return Number.isFinite(lineBottom) && Number.isFinite(viewTop) && lineBottom <= viewTop
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

/**
 * Everything that has something new in it, as read keys, for "mark as read":
 * { dms: [...], channels: [...] }. Deliberately WIDER than countUnread: anything that shows
 * a dot should be cleared by "mark as read", so this includes the channels of a muted group
 * (which countUnread leaves out of the badge) and a DM whose last message is your own (which
 * the DM list still dots, since it only compares times).
 */
export function unreadKeys({ dmConvos = [], channelsByGroup = {}, lastRead = {} } = {}) {
  const dms = []
  for (const dm of dmConvos || []) {
    const key = pathToReadKey(`dms/${dm.id}`)
    if (isUnread(dm.lastMessageAt, lastRead?.[key])) dms.push(key)
  }
  const channels = []
  for (const [groupId, list] of Object.entries(channelsByGroup || {})) {
    for (const c of list || []) {
      const key = pathToReadKey(`groups/${groupId}/channels/${c.id}`)
      if (isUnread(c.lastMessageAt, lastRead?.[key])) channels.push(key)
    }
  }
  return { dms, channels }
}

/** The keys without repeats, in pieces of at most `size`, so one write never grows without limit. */
export function chunkKeys(keys, size = 300) {
  const n = Number.isInteger(size) && size > 0 ? size : 300
  const unique = [...new Set(keys || [])]
  const out = []
  for (let i = 0; i < unique.length; i += n) out.push(unique.slice(i, i + n))
  return out
}

/** "(3) Punx Messenger"; nothing added when there is nothing new. */
export function titleWithCount(base, n) {
  if (!n || n < 1) return base
  return `(${n > 99 ? '99+' : n}) ${base}`
}
