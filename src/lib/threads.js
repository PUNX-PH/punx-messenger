// Threads, built from replies that already exist.
//
// A reply carries `replyTo.messageId`. A thread is a message plus the messages that reply to it,
// so nothing new is stored and the phone, bots and older messages already take part: every reply
// ever sent is in a thread. Replies still appear in the conversation, with their quote, as before;
// the thread is the same replies gathered in one place.
//
// Only direct replies belong to a thread. A reply to a reply starts a thread of its own, so a
// thread is flat and never nests.

/** The id of the message this one replies to, or null (not a reply, malformed, or "a reply to itself"). */
export function replyTargetOf(message) {
  const id = message?.replyTo?.messageId
  if (typeof id !== 'string' || id === '' || id === message?.id) return null
  return id
}

/** How many direct replies each message has in `messages`: Map of message id -> count (only those with any). */
export function replyCounts(messages) {
  const counts = new Map()
  for (const m of messages || []) {
    const target = replyTargetOf(m)
    if (target) counts.set(target, (counts.get(target) || 0) + 1)
  }
  return counts
}

/** Do two count maps say the same thing? Used to hand the list the SAME map when nothing changed, so a message that arrives does not redraw every row. */
export function sameCounts(a, b) {
  if (!a || !b || a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

const timeOf = (m) => {
  const t = m?.createdAt
  const ms = typeof t?.toMillis === 'function' ? t.toMillis() : t
  return Number.isFinite(ms) ? ms : null
}

/** Oldest first; a message still being sent (no time yet) last; ties by id so the order never flickers. */
export function sortByTime(list) {
  return [...(list || [])].sort((a, b) => {
    const ta = timeOf(a), tb = timeOf(b)
    if (ta === null && tb !== null) return 1
    if (tb === null && ta !== null) return -1
    if (ta !== tb && ta !== null) return ta - tb
    return String(a?.id).localeCompare(String(b?.id))
  })
}

/** The replies to `rootId` among `list`, in order. (The root is never one of them: a message cannot reply to itself, see replyTargetOf.) */
export function threadReplies(list, rootId) {
  if (typeof rootId !== 'string') return [] // null would match every message that is not a reply
  return sortByTime((list || []).filter(m => replyTargetOf(m) === rootId))
}

/** "1 reply", "3 replies". */
export const replyLabel = (n) => `${n} ${n === 1 ? 'reply' : 'replies'}`

/** Where threads are offered: conversations, not your private notes (nobody to reply to). */
export const threadsAllowed = (path) => typeof path === 'string' && (path.startsWith('dms/') || path.startsWith('groups/'))

/** What is open: the message as it is now if it is still loaded, else the copy taken when the thread was opened. */
export function currentRoot(messages, opened) {
  if (!opened) return null
  return (messages || []).find(m => m.id === opened.id) || opened
}
