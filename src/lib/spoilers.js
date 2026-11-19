// Spoilers: ||text|| hides text until it is pressed, as on Discord.
//
// The message is stored as it was typed, so ||like this|| is what is in the database, and an older
// client simply shows the bars. It is a spoiler only when the bars touch the words on both sides:
// "a || b || c" (code, a table) and "||||" are not.
//
// Anywhere text is shown as plain text instead of drawn by renderMessage (the quote in a reply, a
// search result, the pinned list, a notification, the preview of a conversation), hideSpoilers puts
// "[spoiler]" where the hidden text is, so it stays hidden there too.

/** One spoiler, as a piece of a regular expression (no groups): bars, a word character at each end, no bar or line break inside. */
export const SPOILER_SOURCE = '\\|\\|[^|\\s](?:[^|\\n]*?[^|\\s])?\\|\\|'

/** The words a spoiler is replaced by where it must not show. */
export const SPOILER_PLACEHOLDER = '[spoiler]'

const SPOILER_ONLY = new RegExp(`^${SPOILER_SOURCE}$`)

/** Is this whole piece of text one spoiler? */
export const isSpoiler = (s) => typeof s === 'string' && SPOILER_ONLY.test(s)

/** What is inside a spoiler: the text without its bars. */
export const spoilerInner = (s) => s.slice(2, -2)

/**
 * `text` with every spoiler in it replaced by "[spoiler]", for the places that show plain text.
 * Anything that is not a string comes back as it was.
 */
export function hideSpoilers(text) {
  if (typeof text !== 'string') return text
  return text.replace(new RegExp(SPOILER_SOURCE, 'g'), SPOILER_PLACEHOLDER)
}
