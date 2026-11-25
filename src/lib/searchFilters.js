// Search with filters. Words and `operator:value` pieces can be mixed in one box:
//
//   from:ana            written by someone whose name contains "ana"  (from:me: written by you)
//   mentions:ana        mentions that person                          (mentions:me: mentions you)
//   has:image           has a picture   (also: voice, link, reply)
//   is:pinned           is pinned       (also: edited)
//   before:2026-11-01   sent on a day before that one
//   after:2026-11-01    sent on a day after that one
//   on:2026-11-01       sent on that day
//
// A value with spaces goes in quotes: from:"Ana Reyes". Different filters all have to hold; the same
// filter given twice is an "or" for from: and mentions: ("from:ana from:ben") and an "and" for has:.
// Whatever is left over is the words to look for. Days are in the reader's own time zone.
//
// Only the messages that are loaded are searched (the same as before), newest first.
import { fold } from './fold.js'
import { hideSpoilers } from './spoilers.js'

export const SEARCH_LIMIT = 100

export const HAS_VALUES = ['image', 'voice', 'link', 'reply']
export const IS_VALUES = ['pinned', 'edited']

// The pieces the box offers as one-press toggles, in this order.
export const FILTER_CHIPS = [
  { token: 'has:image', label: 'Pictures' },
  { token: 'has:voice', label: 'Voice' },
  { token: 'has:link', label: 'Links' },
  { token: 'has:reply', label: 'Replies' },
  { token: 'is:pinned', label: 'Pinned' },
]

// An operator is only one at the start of a word, so "https://x" and "re:hi" stay words.
const OPERATOR = /(^|\s)(from|mentions|has|is|before|after|on):("[^"]*"|\S*)/gi

/** A day written 2026-11-01 as the start of that day (local time), or null if it is not a real day. */
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  const t = new Date(y, mo - 1, d)
  // A month or day that does not exist rolls over into the next one (month 13 is next January, the
  // 30th of February is the 2nd of March), which changes the year or the day: so these two are enough.
  if (t.getFullYear() !== y || t.getDate() !== d) return null
  return t.getTime()
}

const nextDay = (startMs) => {
  const t = new Date(startMs)
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime()
}

/**
 * Take a query apart: { text, from, mentions, has, is, before, after, on, problems }.
 * `before`/`after`/`on` are the start of the day in milliseconds or null; `problems` are sentences
 * about pieces that could not be used (they are left out of the search, not turned into words).
 * A piece with nothing after the colon yet ("from:") is ignored: it is being typed.
 */
export function parseSearch(query) {
  const out = { text: '', from: [], mentions: [], has: [], is: [], before: null, after: null, on: null, problems: [] }
  // (The words either side of a piece were already apart by a space, and the spaces are tidied below.)
  const rest = String(query || '').replace(OPERATOR, (_all, _lead, op, raw) => {
    const value = raw.replace(/^"|"$/g, '').trim()
    if (value !== '') apply(out, op.toLowerCase(), value)
    return ''
  })
  out.text = rest.replace(/\s+/g, ' ').trim()
  // Only marks (an accent on its own) is nothing to look for; folded it would be "", which is in every text.
  if (fold(out.text) === '') out.text = ''
  return out
}

function apply(out, key, value) {
  const v = value.toLowerCase()
  if (key === 'from' || key === 'mentions') {
    if (foldName(v) === '') return // only marks (or quotes): it would name everyone
    if (!out[key].includes(v)) out[key].push(v)
  } else if (key === 'has') {
    if (!HAS_VALUES.includes(v)) out.problems.push(`"has:${value}" is not something to look for (try ${HAS_VALUES.join(', ')}).`)
    else if (!out.has.includes(v)) out.has.push(v)
  } else if (key === 'is') {
    if (!IS_VALUES.includes(v)) out.problems.push(`"is:${value}" is not something to look for (try ${IS_VALUES.join(', ')}).`)
    else if (!out.is.includes(v)) out.is.push(v)
  } else {
    const day = parseDay(value)
    if (day === null) out.problems.push(`"${key}:${value}" is not a day (write it like 2026-11-01).`)
    else out[key] = day
  }
}

/** Is there anything to narrow the search other than words? */
export const hasFilters = (p) => !!(p.from.length || p.mentions.length || p.has.length || p.is.length || p.before !== null || p.after !== null || p.on !== null)

const LINK = /https?:\/\/\S+/i

// A name for comparing: no capitals, no accents, and no double quotes (a quote cannot be written inside the
// quotes of from:"...", so the picker leaves it out of a name, and it must not matter when matching).
const foldName = (s) => fold(s).replace(/"/g, '')

const timeOf = (m) => {
  const t = m?.createdAt
  const ms = typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t?.toDate === 'function' ? t.toDate().getTime() : t)
  return Number.isFinite(ms) ? ms : null
}

const authorName = (m, usersById) => String(usersById?.[m.author?.uid]?.name || m.author?.name || '')

/** Does this message pass every filter in `p` (a parseSearch result)? `ctx`: { usersById, meUid }. */
export function matches(m, p, ctx = {}) {
  const { usersById, meUid } = ctx
  // Capitals and accents never matter: "cafe" finds "Café", from:jose finds José.
  // Of what is shown: a spoiler is "[spoiler]" here too, so searching cannot find the words it hides.
  if (p.text && !fold(hideSpoilers(m.text)).includes(fold(p.text))) return false

  if (p.from.length) {
    const name = foldName(authorName(m, usersById))
    if (!p.from.some(v => (v === 'me' ? !!meUid && m.author?.uid === meUid : name.includes(foldName(v))))) return false
  }
  if (p.mentions.length) {
    const uids = Array.isArray(m.mentionedUids) ? m.mentionedUids : []
    const hit = (v) => v === 'me'
      ? !!meUid && uids.includes(meUid)
      : uids.some(uid => foldName(usersById?.[uid]?.name).includes(foldName(v)))
    if (!p.mentions.some(hit)) return false
  }
  for (const h of p.has) {
    if (h === 'image' && !m.imageURL) return false
    if (h === 'voice' && !m.audioURL) return false
    if (h === 'link' && !LINK.test(String(m.text || ''))) return false
    if (h === 'reply' && !m.replyTo?.messageId) return false
  }
  for (const i of p.is) {
    if (i === 'pinned' && m.pinned !== true) return false
    if (i === 'edited' && !m.editedAt) return false
  }
  if (p.before !== null || p.after !== null || p.on !== null) {
    const t = timeOf(m)
    if (t === null) return false // not sent yet: no day to compare
    if (p.before !== null && !(t < p.before)) return false
    if (p.after !== null && !(t >= nextDay(p.after))) return false
    if (p.on !== null && !(t >= p.on && t < nextDay(p.on))) return false
  }
  return true
}

/**
 * Search `messages` (oldest first, as ChatSurface has them) for `query`.
 * Returns { results, parsed, active }: the matches newest first (at most `limit`), the query taken
 * apart, and whether there was anything to search for (words or a filter) at all.
 */
export function searchMessages(messages, query, { usersById, meUid, limit = SEARCH_LIMIT } = {}) {
  const parsed = parseSearch(query)
  const active = parsed.text !== '' || hasFilters(parsed)
  if (!active) return { results: [], parsed, active }
  const results = []
  const list = messages || []
  for (let i = list.length - 1; i >= 0 && results.length < limit; i--) {
    if (matches(list[i], parsed, { usersById, meUid })) results.push(list[i])
  }
  return { results, parsed, active }
}

const sameToken = (a, b) => a.toLowerCase() === b.toLowerCase()
const wordsOf = (q) => String(q || '').split(/\s+/).filter(Boolean)

/** Is `token` (like "has:image") one of the words in the box? */
export const hasToken = (query, token) => wordsOf(query).some(w => sameToken(w, token))

/** Put `token` in the box, or take it out if it is there: what a filter button does. */
export function toggleToken(query, token) {
  const words = wordsOf(query)
  if (words.some(w => sameToken(w, token))) return words.filter(w => !sameToken(w, token)).join(' ')
  return [...words, token].join(' ')
}
