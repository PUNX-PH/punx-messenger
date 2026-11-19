// Forwarding a message to another conversation. Pure, so it is tested.
//
// A forward is a NEW message from the person forwarding, carrying a copy of the text and the
// picture, and a small `forwardedFrom: { uid, name }` so it can say who wrote it first. Nothing
// else of the original comes along: not its reactions, its pin, its replies, or where it was
// (a message from a private channel must not name that channel to people who are not in it).
//
// Mentions are written out as @Name rather than copied as <@uid> tokens: a forward must not
// ping the people mentioned in it, or tint the row as a mention for them.

import { copyableText, hasCopyableText } from './copyText.js'
import { hideSpoilers } from './spoilers.js'
import { cleanStatusText } from './status.js'
import { audioOf } from './voiceMessage.js'

/** Does this message have something to forward? Text, a picture or a voice message. */
export function canForward(message) {
  return hasCopyableText(message) || (typeof message?.imageURL === 'string' && message.imageURL !== '') || audioOf(message) !== null
}

/**
 * Who a forwarded message came from, as stored on it: { uid, name } or null when it is not a
 * forward or what is stored is not usable. Safe to call on anybody's message: the name is cleaned
 * again here (any member can write anything into a message), one line, at most 60 characters.
 */
export function forwardedFromOf(message) {
  const f = message?.forwardedFrom
  // Anything that is not an object with a usable name (a string, a list, nothing) has no name to clean.
  const name = cleanStatusText(f?.name)
  if (!name) return null
  return { uid: typeof f.uid === 'string' ? f.uid : null, name }
}

/**
 * What to send when forwarding `message`: { text, imageURL, imageMeta, audio, forwardedFrom }.
 * `usersById` turns mentions into names. A message that was itself forwarded keeps its ORIGINAL
 * writer, not the person who passed it on. Null when there is nothing to forward.
 */
export function forwardPayload(message, usersById = {}) {
  if (!canForward(message)) return null
  const earlier = forwardedFromOf(message)
  const authorName = usersById?.[message.author?.uid]?.name || message.author?.name
  const from = earlier || { uid: message.author?.uid ?? null, name: cleanStatusText(authorName) || 'Unknown' }
  const hasImage = typeof message.imageURL === 'string' && message.imageURL !== ''
  const voice = audioOf(message)
  return {
    text: copyableText(message, usersById),
    imageURL: hasImage ? message.imageURL : null,
    imageMeta: hasImage && message.imageMeta && typeof message.imageMeta === 'object' ? message.imageMeta : null,
    audio: voice ? { dataURL: voice.url, durationMs: voice.durationMs, mime: typeof message.audioMeta?.mime === 'string' ? message.audioMeta.mime : null } : null,
    forwardedFrom: from,
  }
}

/** One line of what is being forwarded, for the dialog (mentions as names, as they will be sent). */
export function forwardPreview(message, max = 160, usersById = {}) {
  const text = hideSpoilers(copyableText(message, usersById)).replace(/\s+/g, ' ').trim()
  const shown = Array.from(text).slice(0, max).join('')
  if (!shown) return audioOf(message) ? '[voice message]' : '[image]'
  return Array.from(text).length > max ? shown + '…' : shown
}

const CHANNEL_ROUTE = /^\/g\/([A-Za-z0-9_-]{1,64})\/c\/([A-Za-z0-9_-]{1,64})$/

/**
 * The collection a message to this destination goes into, or null when it cannot be forwarded to
 * (a voice room, anything unknown). `dmId` turns two people into their conversation's id.
 */
export function destinationPath(target, meUid, dmId) {
  if (!target || !meUid) return null
  if (target.kind === 'notes') return `users/${meUid}/notes`
  if (target.kind === 'dm') return target.user?.id ? `dms/${dmId(meUid, target.user.id)}/messages` : null
  if (target.kind === 'channel') {
    const m = CHANNEL_ROUTE.exec(String(target.path ?? ''))
    return m ? `groups/${m[1]}/channels/${m[2]}/messages` : null
  }
  return null
}

/**
 * The destinations to offer: your notes, people and text channels, without voice rooms and without
 * the conversation the message is already in (`currentPath` is that conversation's messages path).
 */
export function forwardTargets(targets, { meUid, currentPath, dmId }) {
  return (Array.isArray(targets) ? targets : []).filter((t) => {
    const path = destinationPath(t, meUid, dmId)
    return path !== null && path !== currentPath
  })
}
