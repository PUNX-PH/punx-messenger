// The person picker of the search box: from: and mentions: offer the people of the chat.
//
//   node --test tests/search-people.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { openPersonPiece, chatPeople, suggestPeople, pickPerson, moveHighlight } from '../src/lib/searchPeople.js'
import { parseSearch, matches } from '../src/lib/searchFilters.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const m = (uid, name, over = {}) => ({ id: 'm-' + Math.random(), text: 'hi', author: { uid, name }, ...over })
const users = {
  ana: { name: 'Ana Reyes' },
  ben: { name: 'Ben Cruz' },
  ian: { name: 'Ian Díaz' },
  jose: { name: 'José Núñez' },
  me: { name: 'Rey' },
}

// ---------- which piece is being typed ----------

test('a from: or mentions: at the end of the box is a piece being typed, with what is typed of the name', () => {
  assert.deepEqual(openPersonPiece('from:'), { op: 'from', partial: '', start: 0 })
  assert.deepEqual(openPersonPiece('from:an'), { op: 'from', partial: 'an', start: 0 })
  assert.deepEqual(openPersonPiece('mentions:ju'), { op: 'mentions', partial: 'ju', start: 0 })
  assert.deepEqual(openPersonPiece('release from:an'), { op: 'from', partial: 'an', start: 8 })
  assert.deepEqual(openPersonPiece('has:image  from:'), { op: 'from', partial: '', start: 11 })
})

test('capitals in the operator do not matter, and it is reported in lower case', () => {
  assert.deepEqual(openPersonPiece('FROM:an'), { op: 'from', partial: 'an', start: 0 })
  assert.equal(openPersonPiece('Mentions:x').op, 'mentions')
})

test('a quote not closed yet is part of the piece, and the quote itself is not in what is typed', () => {
  assert.deepEqual(openPersonPiece('from:"Ana R'), { op: 'from', partial: 'Ana R', start: 0 })
  assert.deepEqual(openPersonPiece('x from:"'), { op: 'from', partial: '', start: 2 })
})

test('a finished piece is not one being typed: a closing quote, a space after it, or another word after it', () => {
  assert.equal(openPersonPiece('from:"Ana Reyes"'), null)
  assert.equal(openPersonPiece('from:ana '), null)
  assert.equal(openPersonPiece('from:ana release'), null)
  assert.equal(openPersonPiece('from:"Ana Reyes" has:'), null)
})

test('only from: and mentions: have people', () => {
  for (const q of ['has:', 'has:im', 'is:pin', 'before:2026', 'on:', '', 'release', 'xfrom:an', 'https://from:x']) assert.equal(openPersonPiece(q), null, q)
  assert.equal(openPersonPiece(null), null)
  assert.equal(openPersonPiece(undefined), null)
})

test('an operator is only one at the start of a word', () => {
  assert.equal(openPersonPiece('refrom:an'), null)
  assert.equal(openPersonPiece('a-from:an'), null)
})

// ---------- the people of the chat ----------

test('from: offers the authors, the one who wrote last first, each once', () => {
  const ms = [m('ana', 'Ana'), m('ben', 'Ben'), m('ana', 'Ana'), m('ian', 'Ian')]
  assert.deepEqual(chatPeople(ms, users, 'from').map(p => p.uid), ['ian', 'ana', 'ben'])
})

test('the name is the live one, or the one written on the message for someone who has gone', () => {
  const ms = [m('ana', 'Old Name'), m('gone', 'Gone Person')]
  assert.deepEqual(chatPeople(ms, users, 'from'), [
    { uid: 'gone', name: 'Gone Person' },
    { uid: 'ana', name: 'Ana Reyes' },
  ])
})

test('an author who has gone is offered under the name on their newest message', () => {
  const ms = [m('gone', 'Old Name'), m('gone', 'New Name')]
  assert.deepEqual(chatPeople(ms, {}, 'from'), [{ uid: 'gone', name: 'New Name' }])
})

test('mentions: offers the people mentioned, by their live name, and no author', () => {
  const ms = [m('ben', 'Ben', { mentionedUids: ['ana', 'jose'] }), m('ian', 'Ian', { mentionedUids: ['ana', 'nobody'] })]
  assert.deepEqual(chatPeople(ms, users, 'mentions').map(p => p.name), ['Ana Reyes', 'José Núñez'])
})

test('someone with no name, and a message with nothing usable, are left out and do not throw', () => {
  assert.deepEqual(chatPeople([m('x', ''), m('', 'No uid'), { text: 'a' }, null, undefined], {}, 'from'), [])
  assert.deepEqual(chatPeople(null, users, 'from'), [])
  assert.deepEqual(chatPeople([m('a', 'A', { mentionedUids: 'ana' })], users, 'mentions'), [])
})

// ---------- what to offer ----------

const people = ['ana', 'ben', 'ian', 'jose'].map(uid => ({ uid, name: users[uid].name }))
const names = (list) => list.map(p => p.label)

test('nothing typed yet offers everyone, and "Me" first when you could be meant', () => {
  const r = suggestPeople({ op: 'from', partial: '' }, people, { meUid: 'me' })
  assert.deepEqual(names(r), ['Me', 'Ana Reyes', 'Ben Cruz', 'Ian Díaz', 'José Núñez'])
  assert.deepEqual(r[0], { value: 'me', label: 'Me', hint: 'you' })
  assert.deepEqual(names(suggestPeople({ op: 'from', partial: '' }, people, {})), ['Ana Reyes', 'Ben Cruz', 'Ian Díaz', 'José Núñez'], 'no "Me" without knowing who you are')
})

test('what is typed narrows it, ignoring accents and capitals', () => {
  assert.deepEqual(names(suggestPeople({ partial: 'jose' }, people, {})), ['José Núñez'])
  assert.deepEqual(names(suggestPeople({ partial: 'NUNEZ' }, people, {})), ['José Núñez'])
  assert.deepEqual(names(suggestPeople({ partial: 'diaz' }, people, {})), ['Ian Díaz'])
  assert.deepEqual(names(suggestPeople({ partial: 'zzz' }, people, {})), [])
})

test('a name that starts a word is offered before one that only holds it inside', () => {
  const ppl = [{ uid: 'a', name: 'Marian Cole' }, { uid: 'b', name: 'Ian Cruz' }, { uid: 'c', name: 'Dan Fiann' }]
  assert.deepEqual(names(suggestPeople({ partial: 'ian' }, ppl, {})), ['Ian Cruz', 'Marian Cole', 'Dan Fiann'])
  // a first name and the start of the last name, with the space: the one that starts with it first
  assert.deepEqual(names(suggestPeople({ partial: 'ian c' }, ppl, {})), ['Ian Cruz', 'Marian Cole'])
  assert.deepEqual(names(suggestPeople({ partial: 'marian' }, ppl, {})), ['Marian Cole'])
})

test('the order of the people is kept within each group (the last one to write first)', () => {
  const ppl = [{ uid: 'z', name: 'Zed Ana' }, { uid: 'y', name: 'Yan Ana' }]
  assert.deepEqual(names(suggestPeople({ partial: 'ana' }, ppl, {})), ['Zed Ana', 'Yan Ana'])
})

test('typing accents works, in either case (the names are accent-free in the box, or not)', () => {
  assert.deepEqual(names(suggestPeople({ partial: 'JOSÉ' }, people, {})), ['José Núñez'])
  assert.deepEqual(names(suggestPeople({ partial: 'núñez' }, people, {})), ['José Núñez'])
  assert.deepEqual(names(suggestPeople({ partial: 'DÍAZ' }, people, {})), ['Ian Díaz'])
})

test('"Me" is offered for m, me, and not for other letters; and you are not also offered by name', () => {
  assert.equal(suggestPeople({ partial: 'm' }, people, { meUid: 'me' })[0].value, 'me')
  assert.equal(suggestPeople({ partial: 'me' }, people, { meUid: 'me' })[0].value, 'me')
  assert.equal(suggestPeople({ partial: 'ME' }, people, { meUid: 'me' })[0].value, 'me')
  assert.ok(!suggestPeople({ partial: 'b' }, people, { meUid: 'me' }).some(p => p.value === 'me'))
  assert.ok(!suggestPeople({ partial: 'e' }, people, { meUid: 'me' }).some(p => p.value === 'me'), 'e is not the start of me')
  assert.ok(!suggestPeople({ partial: 'mex' }, people, { meUid: 'me' }).some(p => p.value === 'me'))
  const withMe = [...people, { uid: 'me', name: 'Rey' }]
  assert.deepEqual(names(suggestPeople({ partial: 'rey' }, withMe, { meUid: 'me' })), ['Ana Reyes'], 'Rey is "Me", not a second entry')
})

test('at most six are offered, and a limit can be given', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ uid: 'u' + i, name: 'Person ' + i }))
  assert.equal(suggestPeople({ partial: '' }, many, { meUid: 'me' }).length, 6)
  assert.equal(suggestPeople({ partial: 'person' }, many, {}).length, 6)
  assert.equal(suggestPeople({ partial: 'person' }, many, { limit: 3 }).length, 3)
})

test('nothing without a piece, and no people is no list', () => {
  assert.deepEqual(suggestPeople(null, people, {}), [])
  assert.deepEqual(suggestPeople({ partial: 'a' }, [], {}), [])
  assert.deepEqual(suggestPeople({ partial: 'a' }, null, {}), [])
})

test('a double quote in a name cannot be quoted, so it is dropped from the value (the label keeps it)', () => {
  const r = suggestPeople({ partial: 'dan' }, [{ uid: 'q', name: 'Dan "Dee" Cole' }], {})
  assert.deepEqual(r, [{ value: 'Dan Dee Cole', label: 'Dan "Dee" Cole' }])
})

// ---------- writing the piece ----------

test('a name with spaces is quoted, one without is not, and a space follows', () => {
  assert.equal(pickPerson('from:an', { op: 'from', start: 0 }, 'Ana Reyes'), 'from:"Ana Reyes" ')
  assert.equal(pickPerson('from:', { op: 'from', start: 0 }, 'me'), 'from:me ')
  assert.equal(pickPerson('from:b', { op: 'from', start: 0 }, 'Ben'), 'from:Ben ')
})

test('what came before stays, and the piece is replaced, not added to', () => {
  const q = 'release has:image from:"Ana R'
  const piece = openPersonPiece(q)
  assert.equal(pickPerson(q, piece, 'Ana Reyes'), 'release has:image from:"Ana Reyes" ')
  assert.equal(pickPerson('mentions:j', openPersonPiece('mentions:j'), 'José Núñez'), 'mentions:"José Núñez" ')
})

test('what is written is a finished piece, and the search finds that person (also by accent-free typing)', () => {
  const q = pickPerson('from:jo', openPersonPiece('from:jo'), 'José Núñez')
  assert.equal(openPersonPiece(q), null, 'finished: no more offers')
  const p = parseSearch(q)
  assert.deepEqual(p.from, ['josé núñez'])
  assert.equal(matches(m('jose', 'José Núñez'), p, { usersById: users }), true)
  assert.equal(matches(m('ben', 'Ben Cruz'), p, { usersById: users }), false)
})

test('picking from a chat end to end: type, see the people, press one', () => {
  const ms = [m('ben', 'Ben'), m('ana', 'Ana'), m('jose', 'José')]
  const typed = 'budget from:jo'
  const piece = openPersonPiece(typed)
  const offered = suggestPeople(piece, chatPeople(ms, users, piece.op), { meUid: 'me' })
  assert.deepEqual(offered.map(p => p.label), ['José Núñez'])
  assert.equal(pickPerson(typed, piece, offered[0].value), 'budget from:"José Núñez" ')
})

// ---------- the highlight ----------

test('down and up move the highlight and go round the ends', () => {
  assert.equal(moveHighlight(0, 'ArrowDown', 3), 1)
  assert.equal(moveHighlight(2, 'ArrowDown', 3), 0)
  assert.equal(moveHighlight(1, 'ArrowUp', 3), 0)
  assert.equal(moveHighlight(0, 'ArrowUp', 3), 2)
  assert.equal(moveHighlight(0, 'ArrowDown', 1), 0)
  assert.equal(moveHighlight(0, 'ArrowUp', 1), 0)
})

test('another key leaves it, and no list has the first place', () => {
  assert.equal(moveHighlight(2, 'a', 3), 2)
  assert.equal(moveHighlight(1, 'Enter', 3), 1)
  assert.equal(moveHighlight(2, 'ArrowDown', 0), 0)
})

// ---------- the box ----------

test('the box offers them while typing, and keys work (pinned against the source)', () => {
  const s = read('src/components/SearchDropdown.jsx')
  assert.ok(s.includes("import { chatPeople, moveHighlight, openPersonPiece, pickPerson, suggestPeople } from '../lib/searchPeople'"))
  assert.ok(s.includes('const piece = useMemo(() => openPersonPiece(q), [q])'))
  assert.ok(s.includes('suggestPeople(piece, chatPeople(messages, usersById, piece.op), { meUid })'))
  assert.ok(s.includes('setQ(pickPerson(q, piece, value))'))
  assert.ok(s.includes("e.key === 'ArrowDown' || e.key === 'ArrowUp'"))
  assert.ok(s.includes('setHi(moveHighlight(at, e.key, people.length))'))
  assert.ok(s.includes('const at = Math.min(hi, people.length - 1)'))
  assert.ok(s.includes('onChange={e => { setQ(e.target.value); setHi(0) }}'), 'typing starts from the first again')
  assert.ok(s.includes('onKeyDown={onInputKey}'))
  assert.ok(s.includes('role="listbox"'))
  assert.ok(s.includes('role="combobox"'))
  assert.ok(s.includes('aria-expanded={people.length > 0}'))
  assert.ok(s.includes('onClick={() => choose(p.value)}'))
  assert.ok(s.includes('choose(people[at].value)'), 'Enter picks the highlighted one')
  // pressing a name must not take the focus away from the box
  assert.ok(s.includes('onMouseDown={e => e.preventDefault()}'))
})

// ---------- found by review ----------

test('two people with one name are one choice (the piece names a name), the nearer-in-time one kept', () => {
  const ppl = [{ uid: 'u1', name: 'Ana Reyes' }, { uid: 'u2', name: 'Ana Reyes' }, { uid: 'u3', name: 'Ana Cruz' }]
  const r = suggestPeople({ partial: 'ana' }, ppl, {})
  assert.deepEqual(names(r), ['Ana Reyes', 'Ana Cruz'])
  assert.equal(new Set(r.map(p => p.value)).size, r.length, 'values (the React keys) are unique')
})

test('names that differ only by a quote are one choice, since the quote is left out of what is written', () => {
  const ppl = [{ uid: 'u1', name: 'Dan Cole' }, { uid: 'u2', name: 'Dan "Cole"' }]
  assert.deepEqual(suggestPeople({ partial: 'dan' }, ppl, {}).map(p => p.value), ['Dan Cole'])
})

test('a person called "Me" is not a second "Me" next to the one that means you', () => {
  const ppl = [{ uid: 'x', name: 'Me' }, { uid: 'y', name: 'Mel Gibbs' }]
  const r = suggestPeople({ partial: 'me' }, ppl, { meUid: 'me' })
  assert.deepEqual(r.map(p => p.value), ['me', 'Mel Gibbs'])
})

test('Enter picks, Tab does not (it must still move on), and an IME that is composing keeps its Enter (pinned against the source)', () => {
  const s = read('src/components/SearchDropdown.jsx')
  assert.ok(s.includes("else if (e.key === 'Enter') { e.preventDefault(); choose(people[at].value) }"))
  assert.ok(!s.includes("e.key === 'Tab'") || s.includes("(not Tab: that must still move on)"))
  assert.ok(!/e\.key === 'Tab'\s*\)/.test(s), 'no branch on Tab')
  assert.ok(s.includes('if (e.nativeEvent?.isComposing || e.keyCode === 229) return'))
  assert.ok(s.indexOf('isComposing') < s.indexOf("e.key === 'ArrowDown'"), 'the IME check comes before any key is handled')
})

test('the highlighted person is announced: ids on the options, aria-activedescendant on the box, controls only while there is a list', () => {
  const s = read('src/components/SearchDropdown.jsx')
  assert.ok(s.includes("aria-activedescendant={people.length > 0 ? `search-person-${at}` : undefined}"))
  assert.ok(s.includes("aria-controls={people.length > 0 ? 'search-people' : undefined}"))
  assert.ok(s.includes('id={`search-person-${i}`}'))
})
