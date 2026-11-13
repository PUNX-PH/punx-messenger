// Saved messages: a bookmark button that keeps a copy of a message in your private notes, with
// who wrote it and, for a channel message, a way back to the original. Pure, so it is tested.
//
// "My Notes" is already a private place only you can read (firestore.rules: users/{uid}/notes),
// so a saved message is a note, and the list of saved messages is My Notes. Nothing new is
// stored anywhere public, and nothing in the rules had to change. (Saving into a field of your
// profile instead would have copied private-channel text into a document every signed-in person
// can read.)
//
// The note's id comes from the message's id, so saving the same message twice is one note, not
// two: the second time just says it is already there.

import { forwardPayload } from './forward.js'

const ID = /^[A-Za-z0-9_-]{1,64}$/
const CHANNEL_MESSAGES = /^groups\/([A-Za-z0-9_-]{1,64})\/channels\/([A-Za-z0-9_-]{1,64})\/messages$/
const ROUTE = /^\/g\/[A-Za-z0-9_-]{1,64}\/c\/[A-Za-z0-9_-]{1,64}\?m=[A-Za-z0-9_-]{1,64}$/

/** The id of the note that holds a saved message, or null for a message that has no usable id. */
export function savedNoteId(messageId) {
  return typeof messageId === 'string' && ID.test(messageId) ? `s_${messageId}` : null
}

/**
 * Where to go to see the original: an in-app address for a message in a channel, null for
 * anything else (a DM has no address that means the same to both people; see messageLink.js).
 */
export function originalRoute(path, messageId) {
  const m = typeof path === 'string' ? CHANNEL_MESSAGES.exec(path) : null
  if (!m || typeof messageId !== 'string' || !ID.test(messageId)) return null
  return `/g/${m[1]}/c/${m[2]}?m=${messageId}`
}

/**
 * What to store for a saved message: the same copy a forward makes (text, picture, who wrote it,
 * mentions as names) plus where it was saved from. `path` is the messages collection it is in.
 * Null when there is nothing to save.
 */
export function savedPayload(message, usersById, path) {
  const copy = forwardPayload(message, usersById)
  if (!copy) return null
  return { ...copy, savedFrom: { route: originalRoute(path, message.id) } }
}

/**
 * The way back to the original, as stored on a saved note: an in-app address or null. Checked
 * again on reading (the shape is fixed, so it can only ever lead into this app).
 */
export function savedRouteOf(message) {
  const r = message?.savedFrom?.route
  return typeof r === 'string' && ROUTE.test(r) ? r : null
}

/** Is this note a saved message? (As opposed to something you typed there, or a plain forward.) */
export const isSavedNote = (message) => !!message?.savedFrom && typeof message.savedFrom === 'object' && !Array.isArray(message.savedFrom)
