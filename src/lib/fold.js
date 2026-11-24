// Folding text for searching: no capitals and no accents, so "cafe" finds "Café", "jose" finds "José",
// "strasse" finds "Straße". Used by the search box to match (words, `from:`, `mentions:`) and to mark
// what matched.
//
//   node --test tests/fold.test.mjs

// Letters that do not take apart into a plain letter and a mark, and what they are written as without.
const SPECIAL = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ı': 'i', 'ς': 'σ' }
const MARK = /\p{M}/gu
const ASCII = /^[\x00-\x7f]*$/

// One character, folded. Always one character at a time, so that the result does not depend on the
// letters around it (JavaScript's own toLowerCase writes a Greek capital sigma differently at the end of a
// word) and so a place in the folded text can be turned back into a place in the real one.
function foldChar(ch) {
  const plain = ch.toLowerCase().normalize('NFD').replace(MARK, '')
  let out = ''
  for (const c of plain) out += SPECIAL[c] ?? c
  return out
}

/** The text without capitals and without accents. */
export function fold(text) {
  const s = String(text ?? '')
  if (ASCII.test(s)) return s.toLowerCase()
  let out = ''
  for (const ch of s) out += foldChar(ch)
  return out
}

/**
 * The same, with where each folded letter came from: `starts[i]` and `ends[i]` are the place in `text`
 * where the character that folded into letter `i` begins and ends. One character can give several letters
 * ("ß" gives "ss"), none (a mark on its own), or one.
 */
export function foldIndexed(text) {
  const s = String(text ?? '')
  const starts = []
  const ends = []
  let folded = ''
  let at = 0
  for (const ch of s) {
    const f = foldChar(ch)
    for (let i = 0; i < f.length; i++) { starts.push(at); ends.push(at + ch.length) }
    folded += f
    at += ch.length
  }
  return { text: folded, starts, ends }
}
