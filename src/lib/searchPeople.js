// A person picker for the search box: while the box ends in `from:` or `mentions:` and a part of a name,
// the people of this chat who match are offered, and pressing one writes the piece for you.
//
//   from:an          ->  Ana Reyes, Ian Cruz           (press one)  ->  from:"Ana Reyes"
//
//   node --test tests/search-people.test.mjs
import { fold } from './fold.js'

// A piece being typed at the very end of the box: from:  from:an  from:"Ana R  (a quote not yet closed).
// A piece with its closing quote, or followed by a space, is finished and not matched.
const OPEN_PIECE = /(^|\s)(from|mentions):("[^"]*|[^\s"]*)$/i

/** `{ op, partial, start }` for the piece being typed at the end of `query` (`start` is where it begins), or null. */
export function openPersonPiece(query) {
  const q = String(query ?? '')
  const m = OPEN_PIECE.exec(q)
  if (!m) return null
  return { op: m[2].toLowerCase(), partial: m[3].replace(/^"/, ''), start: m.index + m[1].length }
}

/**
 * The people a piece can name in these messages, the one who spoke (or was mentioned) last first:
 * `from:` the authors, `mentions:` the people mentioned. Names are the live ones (`usersById`), or for an
 * author who has gone, the name written on the message. Someone with no name is left out.
 */
export function chatPeople(messages, usersById, op) {
  const seen = new Map()
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    const uids = op === 'mentions' ? (Array.isArray(m?.mentionedUids) ? m.mentionedUids : []) : [m?.author?.uid]
    for (const uid of uids) {
      if (!uid || seen.has(uid)) continue
      const name = String(usersById?.[uid]?.name || (op === 'mentions' ? '' : m?.author?.name) || '').trim()
      if (name) seen.set(uid, { uid, name })
    }
  }
  return [...seen.values()]
}

/**
 * What to offer for `piece`: `{ value, label, hint? }` (`value` is what goes after the colon). "Me" first
 * when you could be meant, then the people whose name holds what was typed, those where a word of the name
 * starts with it before those where it is somewhere inside. Accents and capitals do not matter. At most `limit`.
 */
export function suggestPeople(piece, people, { meUid, limit = 6 } = {}) {
  if (!piece) return []
  const q = fold(piece.partial).trim()
  const out = []
  if (meUid && 'me'.startsWith(q)) out.push({ value: 'me', label: 'Me', hint: 'you' })
  const starts = []
  const inside = []
  const taken = new Set(out.map(o => o.value.toLowerCase()))
  for (const p of people || []) {
    if (p.uid === meUid) continue // that is "me"
    const name = fold(p.name)
    if (!name.includes(q)) continue
    const item = { value: p.name.replace(/"/g, ''), label: p.name }
    // Two people with one name are one choice (the piece names a name, not a person), and so is a person
    // called "Me" next to the "Me" that means you.
    if (taken.has(item.value.toLowerCase())) continue
    taken.add(item.value.toLowerCase())
    ;(name.startsWith(q) || name.split(/\s+/).some(w => w.startsWith(q)) ? starts : inside).push(item)
  }
  return [...out, ...starts, ...inside].slice(0, limit)
}

/** Where the highlight goes after a key: ArrowDown and ArrowUp move it, round the ends; any other key leaves it. */
export function moveHighlight(at, key, count) {
  if (!count) return 0
  if (key === 'ArrowDown') return (at + 1) % count
  if (key === 'ArrowUp') return (at - 1 + count) % count
  return at
}

/** The box with the piece being typed replaced by the one chosen (quoted if it has spaces), and a space after it. */
export function pickPerson(query, piece, value) {
  const v = /\s/.test(value) ? `"${value}"` : value
  return String(query ?? '').slice(0, piece.start) + piece.op + ':' + v + ' '
}
