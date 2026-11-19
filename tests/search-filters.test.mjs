// Search with filters: words plus from:, has:, is:, before:/after:/on:, mentions:.
//
//   node --test tests/search-filters.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  SEARCH_LIMIT, HAS_VALUES, IS_VALUES, FILTER_CHIPS,
  parseDay, parseSearch, hasFilters, matches, searchMessages, hasToken, toggleToken,
} from '../src/lib/searchFilters.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const ts = (ms) => ({ toMillis: () => ms })
const at = (y, mo, d, h = 12, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime()
const msg = (id, over = {}) => ({ id, text: 'text ' + id, author: { uid: 'u-' + id, name: 'Name ' + id }, createdAt: ts(at(2026, 11, 10)), ...over })
const ids = (l) => l.map(m => m.id)

const users = {
  ana: { name: 'Ana Reyes' },
  ben: { name: 'Ben Cruz' },
  me: { name: 'Rey' },
}
const ctx = { usersById: users, meUid: 'me' }
const run = (m, q) => matches(m, parseSearch(q), ctx)

// ---------- the numbers ----------

test('the limits and the lists the box offers', () => {
  assert.equal(SEARCH_LIMIT, 100)
  assert.deepEqual(HAS_VALUES, ['image', 'voice', 'link', 'reply'])
  assert.deepEqual(IS_VALUES, ['pinned', 'edited'])
  assert.deepEqual(FILTER_CHIPS.map(c => c.token), ['has:image', 'has:voice', 'has:link', 'has:reply', 'is:pinned'])
})

// ---------- days ----------

test('a day is written year-month-day, and must be a real day', () => {
  assert.equal(parseDay('2026-11-01'), at(2026, 11, 1, 0))
  assert.equal(parseDay(' 2026-11-01 '), at(2026, 11, 1, 0), 'spaces around are fine')
  assert.equal(parseDay('2028-02-29'), at(2028, 2, 29, 0), 'a leap day')
  for (const bad of ['0026-11-01', '2027-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-31', '2026-1-1', '26-11-01', 'banana', '', null, undefined, '2026/11/01', '2026-11-01T10:00']) {
    assert.equal(parseDay(bad), null, String(bad))
  }
})

// ---------- taking a query apart ----------

test('words only: collapsed and trimmed, no filters', () => {
  const p = parseSearch('  hello    big   world ')
  assert.equal(p.text, 'hello big world')
  assert.equal(hasFilters(p), false)
  assert.deepEqual(p.problems, [])
})

test('nothing, or not text, is an empty search', () => {
  for (const q of ['', '   ', null, undefined]) {
    const p = parseSearch(q)
    assert.equal(p.text, '')
    assert.equal(hasFilters(p), false)
  }
})

test('each filter is read, the rest is the words, wherever the filter stands', () => {
  const p = parseSearch('hello from:ana world has:image')
  assert.equal(p.text, 'hello world')
  assert.deepEqual(p.from, ['ana'])
  assert.deepEqual(p.has, ['image'])
})

test('filters are not case sensitive, and the value is kept in lower case', () => {
  const p = parseSearch('FROM:Ana HAS:Image IS:Pinned')
  assert.deepEqual(p.from, ['ana'])
  assert.deepEqual(p.has, ['image'])
  assert.deepEqual(p.is, ['pinned'])
})

test('a value in quotes may have spaces', () => {
  const p = parseSearch('from:"Ana Reyes" hi')
  assert.deepEqual(p.from, ['ana reyes'])
  assert.equal(p.text, 'hi')
})

test('spaces just inside the quotes are not part of the name', () => {
  assert.deepEqual(parseSearch('from:" ana "').from, ['ana'])
  assert.deepEqual(parseSearch('from:"   "').from, [], 'only spaces is nothing yet')
})

test('words either side of a piece do not run together, and the piece can start or end the query', () => {
  assert.equal(parseSearch('a from:x b').text, 'a b')
  assert.equal(parseSearch('from:x a b').text, 'a b')
  assert.equal(parseSearch('a b from:x').text, 'a b')
  assert.equal(parseSearch('a from:x b has:image c').text, 'a b c')
  assert.equal(parseSearch('from:x').text, '')
})

test('it is a filter only at the start of a word: links and other words with a colon stay words', () => {
  assert.equal(parseSearch('see https://example.com/a').text, 'see https://example.com/a')
  assert.equal(parseSearch('re:hello').text, 're:hello')
  assert.equal(parseSearch('xfrom:ana').text, 'xfrom:ana')
  assert.equal(parseSearch('info:x').text, 'info:x')
  assert.equal(parseSearch('foo:bar').text, 'foo:bar', 'an unknown filter is just words')
  assert.deepEqual(parseSearch('xfrom:ana').from, [])
})

test('"from:" with nothing after it yet is being typed: it is ignored, not searched for', () => {
  const p = parseSearch('from:')
  assert.equal(p.text, '')
  assert.deepEqual(p.from, [])
  assert.deepEqual(p.problems, [])
  const q = parseSearch('from: ana')
  assert.deepEqual(q.from, [])
  assert.equal(q.text, 'ana')
  assert.deepEqual(parseSearch('from:""').from, [], 'empty quotes too')
})

test('the same is: twice counts once too', () => {
  assert.deepEqual(parseSearch('is:pinned is:PINNED').is, ['pinned'])
})

test('the same piece twice counts once; different people are both kept', () => {
  assert.deepEqual(parseSearch('from:ana from:ANA').from, ['ana'])
  assert.deepEqual(parseSearch('from:ana from:ben').from, ['ana', 'ben'])
  assert.deepEqual(parseSearch('has:image has:image').has, ['image'])
  assert.deepEqual(parseSearch('mentions:ana mentions:ben').mentions, ['ana', 'ben'])
})

test('has: and is: take only what they know; the rest is a problem, not a word', () => {
  const p = parseSearch('has:banana is:funny hi')
  assert.deepEqual(p.has, [])
  assert.deepEqual(p.is, [])
  assert.equal(p.text, 'hi', 'the bad pieces are not searched for as words')
  assert.equal(p.problems.length, 2)
  assert.match(p.problems[0], /has:banana/)
  assert.match(p.problems[0], /image, voice, link, reply/)
  assert.match(p.problems[1], /is:funny/)
  assert.match(p.problems[1], /pinned, edited/)
  assert.equal(hasFilters(p), false, 'so nothing is filtered by them')
})

test('every value of has: and is: is accepted', () => {
  assert.deepEqual(parseSearch(HAS_VALUES.map(v => 'has:' + v).join(' ')).has, HAS_VALUES)
  assert.deepEqual(parseSearch(IS_VALUES.map(v => 'is:' + v).join(' ')).is, IS_VALUES)
})

test('days: before, after, on', () => {
  const p = parseSearch('before:2026-11-05 after:2026-10-01 on:2026-11-02')
  assert.equal(p.before, at(2026, 11, 5, 0))
  assert.equal(p.after, at(2026, 10, 1, 0))
  assert.equal(p.on, at(2026, 11, 2, 0))
  assert.deepEqual(p.problems, [])
  assert.equal(p.text, '')
})

test('a day that is not a day is a problem, and is not applied', () => {
  for (const op of ['before', 'after', 'on']) {
    const p = parseSearch(`${op}:2026-13-45 hi`)
    assert.equal(p[op], null, op)
    assert.equal(p.problems.length, 1, op)
    assert.match(p.problems[0], new RegExp(`${op}:2026-13-45`), op)
    assert.match(p.problems[0], /2026-11-01/, 'says how to write it')
    assert.equal(p.text, 'hi')
  }
})

test('a day given twice: the last one stands', () => {
  assert.equal(parseSearch('before:2026-01-01 before:2026-02-01').before, at(2026, 2, 1, 0))
})

test('hasFilters is true for each kind of filter on its own', () => {
  for (const q of ['from:a', 'mentions:a', 'has:image', 'is:pinned', 'before:2026-01-01', 'after:2026-01-01', 'on:2026-01-01']) {
    assert.equal(hasFilters(parseSearch(q)), true, q)
  }
})

// ---------- words ----------

test('words are looked for anywhere in the text, in any case', () => {
  assert.equal(run(msg('1', { text: 'The Release Notes' }), 'release'), true)
  assert.equal(run(msg('1', { text: 'The Release Notes' }), 'NOTES'), true)
  assert.equal(run(msg('1', { text: 'The Release Notes' }), 'release notes'), true)
  assert.equal(run(msg('1', { text: 'The Release Notes' }), 'notes release'), false, 'as one phrase, in order')
  assert.equal(run(msg('1', { text: 'The Release Notes' }), 'banana'), false)
  assert.equal(run(msg('1', { text: null }), 'x'), false)
  assert.equal(run(msg('1', { text: undefined }), 'x'), false)
})

// ---------- from ----------

test('from: matches the name as it is now, else the name the message carries', () => {
  const m = msg('1', { author: { uid: 'ana', name: 'Old Name' } })
  assert.equal(run(m, 'from:ana'), true, 'the live name Ana Reyes')
  assert.equal(run(m, 'from:reyes'), true, 'any part of it')
  assert.equal(run(m, 'from:old'), false, 'not the old name while the live one is known')
  const gone = msg('2', { author: { uid: 'nobody', name: 'Gone Person' } })
  assert.equal(run(gone, 'from:gone'), true, 'a removed person still matches by the name on the message')
  assert.equal(run(msg('3', { author: { uid: 'x' } }), 'from:x'), false, 'no name at all')
})

test('from: with a name that has spaces, in quotes', () => {
  assert.equal(run(msg('1', { author: { uid: 'ana' } }), 'from:"ana reyes"'), true)
  assert.equal(run(msg('1', { author: { uid: 'ana' } }), 'from:"reyes ana"'), false)
})

test('from: two people is either of them', () => {
  const a = msg('a', { author: { uid: 'ana' } })
  const b = msg('b', { author: { uid: 'ben' } })
  const c = msg('c', { author: { uid: 'me' } })
  assert.deepEqual(ids([a, b, c].filter(m => run(m, 'from:ana from:ben'))), ['a', 'b'])
})

test('from:me is you, by who you are and not by a name', () => {
  assert.equal(run(msg('1', { author: { uid: 'me' } }), 'from:me'), true)
  assert.equal(run(msg('1', { author: { uid: 'ana' } }), 'from:me'), false)
  assert.equal(run(msg('1', { author: { uid: 'me' } }), 'from:ME'), true)
  assert.equal(matches(msg('1', { author: { uid: 'me' } }), parseSearch('from:me'), { usersById: users }), false, 'nobody known to be you: nothing is "from me"')
  assert.equal(matches(msg('1', { author: { uid: undefined, name: 'Me' } }), parseSearch('from:me'), { usersById: users, meUid: undefined }), false, 'two unknowns are not the same person')
})

// ---------- mentions ----------

test('mentions: finds a message that mentions that person', () => {
  const m = msg('1', { mentionedUids: ['ben'] })
  assert.equal(run(m, 'mentions:ben'), true)
  assert.equal(run(m, 'mentions:cruz'), true, 'any part of the name')
  assert.equal(run(m, 'mentions:ana'), false)
  assert.equal(run(msg('2', {}), 'mentions:ben'), false, 'no list at all')
  assert.equal(run(msg('3', { mentionedUids: 'ben' }), 'mentions:ben'), false, 'a list that is not a list')
  assert.equal(run(msg('4', { mentionedUids: ['stranger'] }), 'mentions:stranger'), false, 'a person who is not known has no name to match')
})

test('mentions: two people is either', () => {
  assert.equal(run(msg('1', { mentionedUids: ['ben'] }), 'mentions:ana mentions:ben'), true)
  assert.equal(run(msg('1', { mentionedUids: ['ben'] }), 'mentions:ana mentions:me'), false)
})

test('mentions:me is you', () => {
  assert.equal(run(msg('1', { mentionedUids: ['me'] }), 'mentions:me'), true)
  assert.equal(run(msg('1', { mentionedUids: ['ben'] }), 'mentions:me'), false)
  assert.equal(matches(msg('1', { mentionedUids: ['me'] }), parseSearch('mentions:me'), { usersById: users }), false)
})

// ---------- has / is ----------

test('has:image, has:voice', () => {
  assert.equal(run(msg('1', { imageURL: 'data:image/png;base64,AAAA' }), 'has:image'), true)
  assert.equal(run(msg('1', { imageURL: 'https://gifs.example/x.gif' }), 'has:image'), true, 'a GIF too')
  assert.equal(run(msg('1', { imageURL: null }), 'has:image'), false)
  assert.equal(run(msg('1', {}), 'has:image'), false)
  assert.equal(run(msg('1', { audioURL: 'data:audio/webm;base64,AAAA' }), 'has:voice'), true)
  assert.equal(run(msg('1', { audioURL: null }), 'has:voice'), false)
  assert.equal(run(msg('1', { imageURL: 'x' }), 'has:voice'), false, 'a picture is not a voice message')
  assert.equal(run(msg('1', { audioURL: 'x' }), 'has:image'), false, 'nor the other way round')
})

test('has:link finds http and https addresses, and not words that only look like one', () => {
  assert.equal(run(msg('1', { text: 'see https://example.com/a?b=1' }), 'has:link'), true)
  assert.equal(run(msg('1', { text: 'old http://example.com' }), 'has:link'), true)
  assert.equal(run(msg('1', { text: 'HTTPS://EXAMPLE.COM' }), 'has:link'), true)
  assert.equal(run(msg('1', { text: 'example.com' }), 'has:link'), false)
  assert.equal(run(msg('1', { text: 'httpx://nope' }), 'has:link'), false)
  assert.equal(run(msg('1', { text: 'https:// ' }), 'has:link'), false, 'no address after it')
  assert.equal(run(msg('1', { text: null }), 'has:link'), false)
})

test('has:reply finds a reply', () => {
  assert.equal(run(msg('1', { replyTo: { messageId: 'a' } }), 'has:reply'), true)
  assert.equal(run(msg('1', { replyTo: null }), 'has:reply'), false)
  assert.equal(run(msg('1', { replyTo: {} }), 'has:reply'), false)
  assert.equal(run(msg('1', { replyTo: { messageId: '' } }), 'has:reply'), false)
})

test('several has: all have to hold', () => {
  const both = msg('1', { imageURL: 'x', text: 'https://a.b' })
  assert.equal(run(both, 'has:image has:link'), true)
  assert.equal(run(msg('2', { imageURL: 'x' }), 'has:image has:link'), false)
  assert.equal(run(msg('3', { text: 'https://a.b' }), 'has:image has:link'), false)
})

test('is:pinned is exactly pinned, and is:edited has been edited', () => {
  assert.equal(run(msg('1', { pinned: true }), 'is:pinned'), true)
  assert.equal(run(msg('1', { pinned: false }), 'is:pinned'), false)
  assert.equal(run(msg('1', { pinned: 'yes' }), 'is:pinned'), false, 'only a real true counts')
  assert.equal(run(msg('1', {}), 'is:pinned'), false)
  assert.equal(run(msg('1', { editedAt: ts(5) }), 'is:edited'), true)
  assert.equal(run(msg('1', { editedAt: null }), 'is:edited'), false)
  assert.equal(run(msg('1', { pinned: true }), 'is:pinned is:edited'), false, 'both have to hold')
})

// ---------- days ----------

test('before: is the days before that day: the day itself is not in it', () => {
  const day = 'before:2026-11-05'
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 4, 23, 59, 59)) }), day), true, 'the last second of the day before')
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 5, 0, 0, 0)) }), day), false, 'midnight starting that day')
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 5, 12)) }), day), false)
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 6, 12)) }), day), false)
  assert.equal(run(msg('1', { createdAt: ts(at(2020, 1, 1)) }), day), true, 'long before')
})

test('after: is the days after that day: the day itself is not in it', () => {
  const day = 'after:2026-11-05'
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 5, 23, 59, 59)) }), day), false, 'the last second of that day')
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 6, 0, 0, 0)) }), day), true, 'midnight starting the next')
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 5, 0, 0, 0)) }), day), false)
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 4, 12)) }), day), false)
  assert.equal(run(msg('1', { createdAt: ts(at(2030, 1, 1)) }), day), true)
})

test('after: at the end of a month and a year', () => {
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 12, 1, 0, 0, 0)) }), 'after:2026-11-30'), true)
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 30, 23, 59, 59)) }), 'after:2026-11-30'), false)
  assert.equal(run(msg('1', { createdAt: ts(at(2027, 1, 1, 0, 0, 0)) }), 'after:2026-12-31'), true)
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 12, 31, 23, 59, 59)) }), 'after:2026-12-31'), false)
})

test('on: is that day, all of it, and nothing either side', () => {
  const day = 'on:2026-11-05'
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 5, 0, 0, 0)) }), day), true, 'its first second')
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 5, 23, 59, 59)) }), day), true, 'its last second')
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 4, 23, 59, 59)) }), day), false)
  assert.equal(run(msg('1', { createdAt: ts(at(2026, 11, 6, 0, 0, 0)) }), day), false)
})

test('a range: after one day and before another', () => {
  const q = 'after:2026-11-01 before:2026-11-05'
  const days = [1, 2, 3, 4, 5].map(d => msg('d' + d, { createdAt: ts(at(2026, 11, d, 12)) }))
  assert.deepEqual(ids(days.filter(m => run(m, q))), ['d2', 'd3', 'd4'])
})

test('times may be server timestamps or plain milliseconds; a message not sent yet has no day', () => {
  const day = 'on:2026-11-10'
  assert.equal(run(msg('1', { createdAt: at(2026, 11, 10, 9) }), day), true, 'plain number')
  assert.equal(run(msg('1', { createdAt: { toDate: () => new Date(at(2026, 11, 10, 9)) } }), day), true, 'a date object')
  assert.equal(run(msg('1', { createdAt: null }), day), false, 'pending')
  assert.equal(run(msg('1', { createdAt: null }), 'before:2030-01-01'), false)
  assert.equal(run(msg('1', { createdAt: null }), 'after:2000-01-01'), false)
  assert.equal(run(msg('1', { createdAt: null }), 'from:name'), true, 'no day filter: still there')
  assert.equal(run(msg('1', { createdAt: Number.NaN }), day), false)
})

// ---------- a day that is not 24 hours long ----------

test('after: and on: use calendar days, also on the day the clocks go back (25 hours) and forward (23)', () => {
  const was = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    // Sanity: this machine really has that time zone now, with a 25-hour day on 2026-11-01.
    const start = new Date(2026, 10, 1).getTime(), end = new Date(2026, 10, 2).getTime()
    assert.equal((end - start) / 3600000, 25, 'the time zone change took effect')
    const late = msg('late', { createdAt: ts(new Date(2026, 10, 1, 23, 30).getTime()) })
    const next = msg('next', { createdAt: ts(new Date(2026, 10, 2, 0, 30).getTime()) })
    assert.equal(run(late, 'after:2026-11-01'), false, 'still that day at 23:30')
    assert.equal(run(next, 'after:2026-11-01'), true)
    assert.equal(run(late, 'on:2026-11-01'), true, 'the 25th hour is in the day')
    assert.equal(run(next, 'on:2026-11-01'), false)
    // Clocks go forward on 2026-03-08: a 23-hour day.
    const s2 = new Date(2026, 2, 8).getTime(), e2 = new Date(2026, 2, 9).getTime()
    assert.equal((e2 - s2) / 3600000, 23)
    assert.equal(run(msg('a', { createdAt: ts(new Date(2026, 2, 9, 0, 30).getTime()) }), 'on:2026-03-08'), false, 'the next day is not in it')
    assert.equal(run(msg('b', { createdAt: ts(new Date(2026, 2, 8, 23, 30).getTime()) }), 'on:2026-03-08'), true)
    assert.equal(run(msg('c', { createdAt: ts(new Date(2026, 2, 9, 0, 30).getTime()) }), 'after:2026-03-08'), true)
  } finally {
    if (was === undefined) delete process.env.TZ; else process.env.TZ = was
  }
})

// ---------- together ----------

test('words and every filter all have to hold', () => {
  const m = msg('1', { text: 'Release notes https://a.b', author: { uid: 'ana' }, imageURL: 'x', pinned: true, createdAt: ts(at(2026, 11, 10)) })
  assert.equal(run(m, 'release from:ana has:image has:link is:pinned on:2026-11-10'), true)
  for (const q of ['banana from:ana', 'release from:ben', 'release has:voice', 'release is:edited', 'release on:2026-11-11', 'release after:2026-11-10']) {
    assert.equal(run(m, q), false, q)
  }
})

// ---------- searching ----------

test('searching returns matches newest first (the list is oldest first)', () => {
  const list = [msg('1', { text: 'a cat' }), msg('2', { text: 'a dog' }), msg('3', { text: 'a cat again' })]
  const { results, active } = searchMessages(list, 'cat', ctx)
  assert.deepEqual(ids(results), ['3', '1'])
  assert.equal(active, true)
})

test('a filter on its own is a search: no words needed', () => {
  const list = [msg('1', { imageURL: 'x' }), msg('2', {}), msg('3', { imageURL: 'y' })]
  const { results, active } = searchMessages(list, 'has:image', ctx)
  assert.deepEqual(ids(results), ['3', '1'])
  assert.equal(active, true)
})

test('nothing to search for is no results, and not active', () => {
  const list = [msg('1'), msg('2')]
  for (const q of ['', '   ', 'from:', 'has:banana', 'before:nonsense']) {
    const r = searchMessages(list, q, ctx)
    assert.deepEqual(r.results, [], q)
    assert.equal(r.active, false, q)
  }
  assert.equal(searchMessages(list, 'has:banana', ctx).parsed.problems.length, 1, 'but the problem is reported')
})

test('no messages, or none given, is no results', () => {
  assert.deepEqual(searchMessages([], 'x', ctx).results, [])
  assert.deepEqual(searchMessages(null, 'x', ctx).results, [])
  assert.deepEqual(searchMessages(undefined, 'x').results, [])
})

test('at most 100 results, the newest 100', () => {
  const list = Array.from({ length: 150 }, (_, i) => msg(String(i), { text: 'hit' }))
  const { results } = searchMessages(list, 'hit', ctx)
  assert.equal(results.length, 100)
  assert.equal(results[0].id, '149')
  assert.equal(results[99].id, '50')
})

test('exactly the limit, and one fewer, and a limit of your own', () => {
  const list = Array.from({ length: 100 }, (_, i) => msg(String(i), { text: 'hit' }))
  assert.equal(searchMessages(list, 'hit', ctx).results.length, 100)
  assert.equal(searchMessages(list.slice(1), 'hit', ctx).results.length, 99)
  assert.deepEqual(ids(searchMessages(list, 'hit', { ...ctx, limit: 3 }).results), ['99', '98', '97'])
})

test('the limit counts matches, not messages looked at', () => {
  const list = []
  for (let i = 0; i < 300; i++) list.push(msg(String(i), { text: i % 3 === 0 ? 'hit' : 'miss' }))
  const { results } = searchMessages(list, 'hit', ctx)
  assert.equal(results.length, 100)
  assert.equal(results[0].id, '297')
})

test('searching leaves the list it was given alone', () => {
  const list = [msg('1', { text: 'x' }), msg('2', { text: 'x' })]
  searchMessages(list, 'x', ctx)
  assert.deepEqual(ids(list), ['1', '2'])
})

test('searching knows who you are and who people are: from:me, from:name, mentions:name', () => {
  const list = [
    msg('mine', { author: { uid: 'me' }, text: 'x' }),
    msg('anas', { author: { uid: 'ana' }, text: 'x', mentionedUids: ['ben'] }),
    msg('bens', { author: { uid: 'ben' }, text: 'x' }),
  ]
  assert.deepEqual(ids(searchMessages(list, 'from:me', ctx).results), ['mine'])
  assert.deepEqual(ids(searchMessages(list, 'from:ana', ctx).results), ['anas'])
  assert.deepEqual(ids(searchMessages(list, 'mentions:cruz', ctx).results), ['anas'])
  assert.deepEqual(searchMessages(list, 'from:me', { usersById: users }).results, [], 'with nobody known to be you')
})

test('the query is handed back taken apart, for showing the words and any problems', () => {
  const { parsed } = searchMessages([msg('1')], 'hello from:ana has:nope', ctx)
  assert.equal(parsed.text, 'hello')
  assert.deepEqual(parsed.from, ['ana'])
  assert.equal(parsed.problems.length, 1)
})

// ---------- the buttons ----------

test('a button puts its filter in the box, and takes it out again', () => {
  assert.equal(toggleToken('', 'has:image'), 'has:image')
  assert.equal(toggleToken('hello', 'has:image'), 'hello has:image')
  assert.equal(toggleToken('hello has:image', 'has:image'), 'hello')
  assert.equal(toggleToken('has:image', 'has:image'), '')
  assert.equal(toggleToken('has:image hello is:pinned', 'has:image'), 'hello is:pinned', 'the rest is left as it was')
})

test('a button knows its filter however it was typed', () => {
  assert.equal(hasToken('hello HAS:Image', 'has:image'), true)
  assert.equal(toggleToken('hello HAS:Image', 'has:image'), 'hello')
  assert.equal(hasToken('hello', 'has:image'), false)
  assert.equal(hasToken('', 'has:image'), false)
  assert.equal(hasToken(null, 'has:image'), false)
  assert.equal(hasToken('has:imagery', 'has:image'), false, 'a longer word is another word')
  assert.equal(toggleToken('has:imagery', 'has:image'), 'has:imagery has:image')
})

test('a button does not mistake a filter for part of a word', () => {
  assert.equal(hasToken('xhas:image', 'has:image'), false)
  assert.equal(toggleToken('  hello   world ', 'is:pinned'), 'hello world is:pinned', 'spaces tidied')
  assert.equal(toggleToken(undefined, 'is:pinned'), 'is:pinned')
})

test('what a button puts in the box is read back as that filter', () => {
  for (const c of FILTER_CHIPS) {
    const p = parseSearch(toggleToken('hi', c.token))
    assert.equal(p.text, 'hi', c.token)
    assert.equal(p.problems.length, 0, c.token)
    assert.equal(hasFilters(p), true, c.token)
  }
})

// ---------- the screen ----------

test('the search box uses the filters, knows who you are, and shows what it could not use', () => {
  const s = read('src/components/SearchDropdown.jsx')
  assert.ok(s.includes("import { FILTER_CHIPS, hasToken, searchMessages, toggleToken } from '../lib/searchFilters'"))
  assert.ok(s.includes('export default function SearchDropdown({ messages, usersById, meUid, onJump, onClose })'))
  assert.ok(s.includes('() => searchMessages(messages, q, { usersById, meUid }),\n    [messages, q, usersById, meUid],'))
  assert.ok(s.includes('{parsed.problems.map(p => ('), 'a piece that could not be used is said')
  assert.ok(s.includes('highlight(m.text, parsed.text)'), 'only the words are marked, not the filters')
  assert.ok(s.includes('{!active ? ('), 'a filter alone is a search too')
  assert.ok(s.includes("        {active && (\n          <div className=\"text-[11px] text-ink-dim mt-1\">\n            {results.length === 0 ? 'No matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}"), 'how many matched, once there is a search')
  assert.ok(!s.includes('.slice(0, 100)'), 'the old substring search is gone')
  assert.ok(!s.includes('const ql = q.trim().toLowerCase()'))
})

test('the buttons are toggles, listed from FILTER_CHIPS, and put the cursor back', () => {
  const s = read('src/components/SearchDropdown.jsx')
  assert.ok(s.includes('{FILTER_CHIPS.map(c => {'))
  assert.ok(s.includes('aria-pressed={on}'))
  assert.ok(s.includes("onClick={() => { setQ(toggleToken(q, c.token)); inputRef.current?.focus() }}"))
  assert.ok(s.includes('const on = hasToken(q, c.token)'))
})

test('the empty box says what can be typed', () => {
  const s = read('src/components/SearchDropdown.jsx')
  for (const hint of ['from:name', 'has:image', 'is:pinned', 'before:2026-11-01', 'mentions:me']) assert.ok(s.includes(hint), hint)
})

test('a picture or a voice message with no words says what it is in the results', () => {
  const s = read('src/components/SearchDropdown.jsx')
  assert.ok(s.includes("if (m.imageURL) return 'Picture'"))
  assert.ok(s.includes("if (m.audioURL) return 'Voice message'"))
  assert.ok(s.includes('{m.text ? highlight(m.text, parsed.text) : <span'))
})

test('the chat gives the search box who you are', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('                usersById={usersById}\n                meUid={profile?.uid}\n                onJump={jumpTo}'))
})

test('the search box is loaded when it is first opened, not with the app, and a failure to load it is contained', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes("import { ForwardDialog, SearchDropdown, ThreadPanel } from '../lib/lazyParts'"))
  assert.ok(!s.includes("from './SearchDropdown'"), 'no ordinary import left')
  assert.ok(s.includes('<LazySlot overlay title="The search box couldn\'t be opened" onDismiss={() => setSearchOpen(false)}>\n              <SearchDropdown'))
  const l = read('src/lib/lazyParts.js')
  assert.ok(l.includes("export const SearchDropdown = lazyWithPreload(() => import('../components/SearchDropdown'))"))
  assert.ok(l.includes('//   SearchDropdown      '), 'listed with the others, with the reason')
})
