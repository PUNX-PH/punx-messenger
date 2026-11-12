// How a conversation's messages are laid out: day dividers, and runs of messages by
// the same person grouped under one name and photo. Pure, so it is tested.

export function toDate(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts instanceof Date) return ts
  return null
}

/**
 * Day dividers and author groups, in one pass. A new day always starts a new group,
 * so a run of messages never straddles a divider.
 *
 * @param {Array} messages oldest first
 * @param {number} groupMinutes messages by the same person this close together share
 *   a group; 0 means never group (every message shows its own name and photo)
 * @param {string|null} newFromId the first unread message: a "new" marker goes just
 *   above it, and it starts a group so the marker never cuts a run in two
 */
export function buildBlocks(messages, groupMinutes = 5, newFromId = null) {
  const windowMs = Math.max(0, groupMinutes) * 60 * 1000
  const blocks = []
  let lastGroup = null
  let lastDay = null
  for (const m of messages || []) {
    const ts = toDate(m.createdAt)
    // A message still waiting for its server timestamp has no date yet. It
    // belongs to the day already on screen, not to a new one.
    const day = ts ? ts.toDateString() : lastDay
    if (day && day !== lastDay) {
      blocks.push({ type: 'day', key: `day-${day}`, date: ts })
      lastDay = day
      lastGroup = null
    }
    if (newFromId && m.id === newFromId) {
      blocks.push({ type: 'new', key: `new-${m.id}` })
      lastGroup = null
    }
    const lastTs = lastGroup && toDate(lastGroup.last)
    const close = windowMs > 0 && lastGroup && (!ts || !lastTs || (ts - lastTs) < windowMs)
    if (lastGroup && lastGroup.author?.uid === m.author?.uid && close) {
      lastGroup.items.push(m); lastGroup.last = m.createdAt
    } else {
      lastGroup = {
        type: 'group',
        // The first message's id, not the array index: older pages are
        // prepended, and an index key would remount — and so reset — every
        // group on screen each time one loaded.
        key: m.id,
        author: m.author,
        items: [m], first: m.createdAt, last: m.createdAt,
      }
      blocks.push(lastGroup)
    }
  }
  return blocks
}
