// Keeps a message the SAME object until that message itself changes.
//
// Every snapshot of a conversation used to rebuild every message from scratch, so
// the list could not tell "a new message arrived" from "all of them changed" and
// re-rendered, and re-parsed the markdown of, every message on screen. Firestore
// already says exactly which documents changed in a snapshot; this turns that
// into object identity, so React can skip the rest.

/**
 * @param {Map<string, object>} previous the objects handed out last time, by id
 * @param {Array<{id: string}>} docs this snapshot's messages, in display order
 * @param {Set<string>} changedIds ids Firestore reported as added or modified
 * @returns {{ messages: object[], next: Map<string, object> }} `messages` holds,
 *   for every message that did not change, the very object from `previous`.
 */
export function shareMessages(previous, docs, changedIds) {
  const next = new Map()
  const messages = docs.map((doc) => {
    const before = previous.get(doc.id)
    const obj = before && !changedIds.has(doc.id) ? before : doc
    next.set(doc.id, obj)
    return obj
  })
  return { messages, next }
}

/** Same messages, in the same order, as the same objects? */
export function sameMessages(a, b) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
