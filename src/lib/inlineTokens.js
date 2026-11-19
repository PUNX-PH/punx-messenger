// The inline pieces of a message's text, found in one pass: `code`, **bold**, ~~strike~~,
// *italic* / _italic_, https://links, :emoji:, <@mentions> and ||spoilers||.
//
// Apart from drawing, so it can be tested on its own (src/lib/markdown.jsx turns each piece into
// something on screen). The phone has the same list in the same order
// (android_app/lib/markdown/message_parser.dart): where two could start in the same place, the one
// listed first wins, so the ORDER is part of the behaviour.
import { SPOILER_SOURCE } from './spoilers.js'

const PARTS = [
  ['code', '`[^`\\n]+?`'],
  ['bold', '\\*\\*[^*\\n]+?\\*\\*'],
  ['strike', '~~[^~\\n]+?~~'],
  ['italic', '\\*[^*\\n]+?\\*'],
  ['italic', '_[^_\\n]+?_'],
  ['url', 'https?://[^\\s<>]+'],
  ['emoji', ':[a-z0-9_]{2,32}:'],
  ['mention', '<@[A-Za-z0-9_-]{6,40}>'],
  ['spoiler', SPOILER_SOURCE],
]

const SOURCE = PARTS.map(([, s]) => `(${s})`).join('|')

/** The kinds, in the order the pieces are tried. */
export const INLINE_KINDS = PARTS.map(([kind]) => kind)

/**
 * Splits `text` into pieces: { type, raw, index }, where type is 'text' for what lies between the
 * others, else one of INLINE_KINDS. Every character of `text` is in exactly one piece, in order.
 */
export function tokenizeInline(text) {
  const out = []
  if (typeof text !== 'string') return out // (an empty text finds nothing below, so it needs no case of its own)
  // A new expression each time: it remembers where it stopped, and a spoiler's inside is read again.
  const re = new RegExp(SOURCE, 'gi')
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', raw: text.slice(last, m.index), index: last })
    const group = m.slice(1).findIndex(g => g !== undefined)
    out.push({ type: PARTS[group][0], raw: m[0], index: m.index })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', raw: text.slice(last), index: last })
  return out
}
