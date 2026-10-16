// Keeps a person's object the SAME object until something about them that the UI
// actually shows has changed.
//
// Why this exists. Every client listens to the whole `users` collection, and every
// online person rewrites their own document every 45 seconds (their `lastSeen`
// heartbeat), plus again whenever they go away or come back, plus whenever they
// read a channel (`lastRead`). Each of those arrives as a fresh snapshot. The
// provider used to rebuild its lookup tables from scratch every time, so the
// context value changed and EVERY component that reads it re-rendered — the
// message list, the composer, both sidebars — to display exactly what they
// displayed a second ago. With ten people online that was a re-render of the
// whole app more than once every four seconds, for everyone.
//
// The fix has two halves. This file is the first: split a user document into the
// part that is about WHO they are (name, photo, role, ...) and the part that is
// about WHEN they were last around (presence, lastSeen), and hand out the same
// object for the first part as long as it has not changed. The second half is
// src/lib/users.jsx, which publishes the second part on its own, slowly.

/** Changes constantly and says nothing about who someone is. */
const VOLATILE = ['presence', 'lastSeen']

/**
 * `lastRead` changes whenever its owner opens a channel. For everybody else it
 * is noise; for the signed-in person it drives their own unread badges, so it
 * must stay live for them and only them.
 */
const OWN_ONLY = ['lastRead']

/** A person without the fields that change on their own. */
export function identityOf(user, isMe = false) {
  const out = { ...user }
  for (const k of VOLATILE) delete out[k]
  if (!isMe) for (const k of OWN_ONLY) delete out[k]
  return out
}

/** The slice of a user document that presence needs, and nothing else. */
export const presenceOf = (user) => ({ presence: user.presence, lastSeen: user.lastSeen })

// Stable text for comparing two identities. Keys are sorted (so field order cannot
// matter) and Firestore Timestamps are reduced to their milliseconds (so two
// Timestamp objects holding the same instant compare equal).
function fingerprint(value) {
  return JSON.stringify(value, (key, v) => {
    if (v && typeof v === 'object') {
      if (typeof v.toMillis === 'function') return { __ts: v.toMillis() }
      if (!Array.isArray(v)) {
        return Object.keys(v).sort().reduce((acc, k) => { acc[k] = v[k]; return acc }, {})
      }
    }
    return v
  })
}

/**
 * Turns a snapshot's user list into identity-stable users plus a presence map.
 *
 * @param {Map<string, {key: string, obj: object}>} previous what the last call returned as `next`
 * @param {Array<{id: string}>} list the raw documents, `{ id, ...data }`
 * @param {string|undefined} meId the signed-in user's id
 * @returns {{ users: object[], next: Map, presence: Record<string, {presence, lastSeen}> }}
 *   `users` holds, for every person whose identity did not change, the very object
 *   from `previous`, so `===` says "nothing to re-render".
 */
export function shareIdentity(previous, list, meId) {
  const next = new Map()
  const users = []
  const presence = {}
  for (const doc of list) {
    presence[doc.id] = presenceOf(doc)
    const identity = identityOf(doc, doc.id === meId)
    const key = fingerprint(identity)
    const before = previous.get(doc.id)
    const obj = before && before.key === key ? before.obj : identity
    next.set(doc.id, { key, obj })
    users.push(obj)
  }
  return { users, next, presence }
}

/** Same people, in the same order, as the same objects? */
export function sameUsers(a, b) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
