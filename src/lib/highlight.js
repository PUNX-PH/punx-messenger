// Cutting a text into what matches a search and what is between, to mark the matches in a result.
// Capitals and accents do not matter ("cafe" marks "CAFÉ"); the text keeps its own letters.
//
//   node --test tests/highlight.test.mjs
import { fold, foldIndexed } from './fold.js'

const TRAILING_MARKS = /^\p{M}+/u

/**
 * `[{ text, match }]`, in order, so that joining the texts gives back `text`. No query (or one that is
 * only marks, which fold to nothing) and no text are one part that does not match.
 */
export function highlightParts(text, query) {
  const t = String(text ?? '')
  const q = fold(query)
  if (!t || !q) return [{ text: t, match: false }]
  const { text: folded, starts, ends } = foldIndexed(t)
  const parts = []
  let from = 0 // where the next part begins, in the real text
  let i = 0 // where to look, in the folded text
  for (;;) {
    const at = folded.indexOf(q, i)
    if (at < 0) break
    const start = starts[at]
    // The marks written after the last letter belong to it (they folded to nothing, so are not in `ends`).
    const end = ends[at + q.length - 1] + (TRAILING_MARKS.exec(t.slice(ends[at + q.length - 1]))?.[0].length ?? 0)
    // A match that begins inside a character the last match already took whole (the second "s" of "ß").
    if (start < from) { i = at + 1; continue }
    if (start > from) parts.push({ text: t.slice(from, start), match: false })
    parts.push({ text: t.slice(start, end), match: true })
    from = end
    i = at + q.length
  }
  if (from < t.length) parts.push({ text: t.slice(from), match: false })
  return parts
}
