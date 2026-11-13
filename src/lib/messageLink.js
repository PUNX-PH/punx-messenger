// A link to one message in a channel: how it is written, how it is read back, and what to do
// next while following one. Pure, so it is tested.
//
//   https://<this site>/g/<groupId>/c/<channelId>?m=<messageId>
//
// Only channels get a link. A DM's address is "the conversation with <the other person>", which
// reads differently to each of the two people, so one link could not be right for both. Private
// notes are not shared at all.
//
// Opening a link is just opening the channel with `?m=`: the chat finds that message, scrolls to
// it and lights it up, then removes the `?m=` so a refresh or a Back does not jump again.

/** The query parameter that names the message. */
export const MESSAGE_PARAM = 'm'

/** How many messages to load, in one go, when the linked one is older than the first page. */
export const LINK_LOOKBACK = 300

const CHANNEL_MESSAGES = /^groups\/([A-Za-z0-9_-]{1,64})\/channels\/([A-Za-z0-9_-]{1,64})\/messages$/
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The link for a message, or null when that kind of conversation has no link (a DM, your notes, an odd path). */
export function messageLink(origin, path, messageId) {
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) return null // (a non-string never matches)
  if (typeof messageId !== 'string' || !MESSAGE_ID.test(messageId)) return null
  const m = CHANNEL_MESSAGES.exec(path) // (a non-string path is read as text and never matches)
  if (!m) return null
  return `${origin}/g/${m[1]}/c/${m[2]}?${MESSAGE_PARAM}=${messageId}`
}

/** The message a URL's query asks for, or null. Takes the URLSearchParams from the router, or a query string. Anything that is not a plain id is ignored. */
export function messageIdFromSearch(search) {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const id = params?.get?.(MESSAGE_PARAM)
  return typeof id === 'string' && MESSAGE_ID.test(id) ? id : null
}

/**
 * What to do next about the message a link points at.
 *   target      the id from the link (or null)
 *   loaded      this conversation's messages have arrived
 *   messages    the ones loaded now
 *   hasMore     there are older ones that are not loaded
 *   limit       how many the chat has asked for
 *   loadedLimit how many the messages on screen were asked for
 * Returns 'none' (no link to follow), 'wait', 'jump' (it is here: scroll to it), 'lookback'
 * (ask for a bigger window, once) or 'missing' (it is not there and will not be).
 */
export function nextLinkStep({ target, loaded, messages, hasMore, limit = 0, loadedLimit = 0 }) {
  if (!target) return 'none'
  if (!loaded) return 'wait'
  if (Array.isArray(messages) && messages.some((m) => m?.id === target)) return 'jump'
  if (!hasMore) return 'missing' // everything there is has been loaded
  if (loadedLimit >= LINK_LOOKBACK) return 'missing' // the big window is in and it is still not there
  if (limit < LINK_LOOKBACK) return 'lookback'
  return 'wait' // the big window was asked for and has not arrived yet
}
