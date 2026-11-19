// Formatting what is selected in the message box: **bold**, _italic_, ~~strike~~, `code`, ||spoiler||.
//
// Pure, so it can be tested: it takes the text and the selection and gives back the new text and the
// new selection. The box (and, on the phone, its own copy of this in utils/formatting.dart) only
// puts the answer on screen.
//
// - Pressing it again on what is already formatted takes the formatting off.
// - With nothing selected it puts the pair of marks at the cursor, the cursor between them; pressing
//   it again between an empty pair takes the pair away.
// - Spaces at the ends of a selection stay OUTSIDE the marks: "** bold**" and "|| secret||" are not
//   bold and not a spoiler, so selecting " secret " gives " ||secret|| ".
// - The marks cannot cross a line break (a message's bold, italic and spoiler end at the end of a
//   line), so a selection of several lines is marked line by line.
// - Italic uses _ and not *, so it can never be mistaken for half of a **bold**.

export const FORMATS = {
  bold: ['**', '**'],
  italic: ['_', '_'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
  spoiler: ['||', '||'],
}

/** The formats, in the order the buttons are shown, with the words for each. */
export const FORMAT_BUTTONS = [
  { name: 'bold', label: 'Bold', shortcut: 'B' },
  { name: 'italic', label: 'Italic', shortcut: 'I' },
  { name: 'strike', label: 'Strikethrough' },
  { name: 'code', label: 'Code' },
  { name: 'spoiler', label: 'Spoiler' },
]

/**
 * The format a key press asks for, or null: Ctrl/Cmd+B is bold and Ctrl/Cmd+I is italic. Only those two:
 * they are what everyone expects, and they do not clash with what a browser keeps for itself.
 */
export function formatShortcut(e) {
  if (!e || e.isComposing || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey)) return null
  const k = String(e.key ?? '').toLowerCase()
  if (k === 'b') return 'bold'
  if (k === 'i') return 'italic'
  return null
}

const isSpace = (ch) => /\s/.test(ch)

// Is the piece text.slice(a, b) already marked? Three answers: 'inside' (the piece is the marks and
// the words, as when the marks were selected too), { outside: [from, to] } (the marks are around it,
// perhaps with other formats' marks between: "**_words_**" is bold with the words italic inside it, and
// the bold's marks are at from - 2 and to), or null.
function markedAt(text, a, b, open, close) {
  const inner = b - a >= open.length + close.length
    && text.slice(a, a + open.length) === open
    && text.slice(b - close.length, b) === close
  if (inner) return 'inside'
  let from = a
  let to = b
  for (;;) {
    if (text.slice(Math.max(0, from - open.length), from) === open && text.slice(to, to + close.length) === close) return { outside: [from, to] }
    // Step out through the marks of some other format that surround it, and look again.
    const step = Object.values(FORMATS).find(([o, c]) =>
      text.slice(Math.max(0, from - o.length), from) === o && text.slice(to, to + c.length) === c)
    if (!step) return null
    from -= step[0].length
    to += step[1].length
  }
}

/**
 * Format the selection [start, end) of `text`. Returns { text, start, end }: the new text and the new
 * selection (on the formatted words, not on the marks).
 */
export function applyFormat(text, start, end, name) {
  const marks = FORMATS[name]
  const value = typeof text === 'string' ? text : ''
  if (!marks) return { text: value, start: clampTo(start, value), end: clampTo(end, value) }
  const [open, close] = marks
  let s = clampTo(start, value)
  let e = clampTo(end, value)
  if (s > e) [s, e] = [e, s]

  // Lines of the selection, each trimmed of spaces: [from, to) pairs, empty lines left out.
  const pieces = []
  let at = s
  while (at < e) {
    let lineEnd = value.indexOf('\n', at)
    if (lineEnd === -1 || lineEnd > e) lineEnd = e
    let a = at
    let b = lineEnd
    while (a < b && isSpace(value[a])) a++
    while (b > a && isSpace(value[b - 1])) b--
    if (b > a) pieces.push([a, b])
    at = lineEnd + 1
  }

  // Nothing but spaces (or nothing) selected: work at the cursor.
  if (pieces.length === 0) {
    const caret = e
    const between = value.slice(Math.max(0, caret - open.length), caret) === open && value.slice(caret, caret + close.length) === close
    if (between) {
      const from = caret - open.length
      return { text: value.slice(0, from) + value.slice(caret + close.length), start: from, end: from }
    }
    const next = value.slice(0, caret) + open + close + value.slice(caret)
    const pos = caret + open.length
    return { text: next, start: pos, end: pos }
  }

  const states = pieces.map(([a, b]) => markedAt(value, a, b, open, close))
  const allMarked = states.every(Boolean)

  // Built forward in one pass: what lies between the pieces is copied, and each piece is wrapped, or
  // unwrapped (when every piece already has its marks), or left as it is (a marked piece among
  // unmarked ones). The new selection runs from the first piece's words to the last one's.
  let out = ''
  let cursor = 0
  let newStart = 0
  let newEnd = 0
  pieces.forEach(([a, b], i) => {
    const state = states[i]
    if (allMarked && state !== 'inside') {
      // The marks are around the piece, perhaps outside other formats' marks: take just these away.
      const [from, to] = state.outside
      out += value.slice(cursor, from - open.length)
      out += value.slice(from, a)
      if (i === 0) newStart = out.length
      out += value.slice(a, b)
      newEnd = out.length
      out += value.slice(b, to)
      cursor = to + close.length
    } else if (allMarked) { // marks inside the piece
      out += value.slice(cursor, a)
      if (i === 0) newStart = out.length
      out += value.slice(a + open.length, b - close.length)
      newEnd = out.length
      cursor = b
    } else if (!state) {
      out += value.slice(cursor, a) + open
      if (i === 0) newStart = out.length
      out += value.slice(a, b)
      newEnd = out.length
      out += close
      cursor = b
    } else {
      out += value.slice(cursor, a)
      if (i === 0) newStart = out.length
      out += value.slice(a, b)
      newEnd = out.length
      cursor = b
    }
  })
  out += value.slice(cursor)
  return { text: out, start: newStart, end: newEnd }
}

function clampTo(n, text) {
  const x = Number.isFinite(n) ? n : 0
  return Math.max(0, Math.min(x, text.length))
}
