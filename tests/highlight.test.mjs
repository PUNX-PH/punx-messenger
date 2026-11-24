// Cutting a result's text into what matches the search and what is between.
//
//   node --test tests/highlight.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { highlightParts } from '../src/lib/highlight.js'

const marked = (t, q) => highlightParts(t, q).filter(p => p.match).map(p => p.text)
const joined = (t, q) => highlightParts(t, q).map(p => p.text).join('')

test('the stretches that match and the ones between, in order', () => {
  assert.deepEqual(highlightParts('the release notes', 'release'), [
    { text: 'the ', match: false },
    { text: 'release', match: true },
    { text: ' notes', match: false },
  ])
})

test('a match at the start or the end leaves no empty stretch', () => {
  assert.deepEqual(highlightParts('ab', 'ab'), [{ text: 'ab', match: true }])
  assert.deepEqual(highlightParts('ab cd ab', 'ab'), [
    { text: 'ab', match: true },
    { text: ' cd ', match: false },
    { text: 'ab', match: true },
  ])
})

test('every match, next to each other and never overlapping', () => {
  assert.deepEqual(marked('aaaa', 'aa'), ['aa', 'aa'])
  assert.deepEqual(marked('aaa', 'aa'), ['aa'])
  assert.deepEqual(marked('ab ab ab', 'ab'), ['ab', 'ab', 'ab'])
})

test('capitals do not matter, and the text keeps its own', () => {
  assert.deepEqual(marked('Release RELEASE release', 'ReLeAsE'), ['Release', 'RELEASE', 'release'])
})

test('accents do not matter, either way round', () => {
  assert.deepEqual(marked('Un café, un CAFÉ, un cafe', 'cafe'), ['café', 'CAFÉ', 'cafe'])
  assert.deepEqual(marked('Un café, un cafe', 'café'), ['café', 'cafe'])
  assert.deepEqual(marked('Hola José', 'JOSE'), ['José'])
})

test('the marks stay where they are in the real text, after other accents and emoji', () => {
  // the match is found in the folded text; it must be cut from the real one at the real place
  assert.deepEqual(highlightParts('Ñandú 👍 café', 'cafe'), [
    { text: 'Ñandú 👍 ', match: false },
    { text: 'café', match: true },
  ])
  assert.deepEqual(marked('éééé x éé', 'ee'), ['éé', 'éé', 'éé'])
})

test('a letter and its mark as two characters is marked whole, mark included', () => {
  const t = 'caf' + 'é' + ' ok'
  assert.deepEqual(highlightParts(t, 'cafe'), [
    { text: 'caf' + 'é', match: true },
    { text: ' ok', match: false },
  ])
})

test('a letter that folds into several is marked whole, and the next match is not cut in it', () => {
  assert.deepEqual(marked('Straße', 'strasse'), ['Straße'])
  assert.deepEqual(marked('Straße', 'stras'), ['Straß'])
  assert.deepEqual(marked('Straße', 'sse'), ['ße'])
  // the second "s" of ß is inside the character the first match already took
  assert.deepEqual(marked('ß', 's'), ['ß'])
  assert.deepEqual(marked('ßß', 's'), ['ß', 'ß'])
})

test('no match, no query or no text is one stretch that is not marked', () => {
  assert.deepEqual(highlightParts('hello', 'xyz'), [{ text: 'hello', match: false }])
  assert.deepEqual(highlightParts('hello', ''), [{ text: 'hello', match: false }])
  assert.deepEqual(highlightParts('hello', null), [{ text: 'hello', match: false }])
  assert.deepEqual(highlightParts('', 'a'), [{ text: '', match: false }])
  assert.deepEqual(highlightParts(null, 'a'), [{ text: '', match: false }])
})

test('a query that is only a mark folds to nothing and marks nothing (and does not loop)', () => {
  assert.deepEqual(highlightParts('hello', '́'), [{ text: 'hello', match: false }])
})

test('joining the stretches gives the text back, whatever the query', () => {
  for (const [t, q] of [
    ['Morning all. Standup is at 10:30.', 'at'],
    ['a.b.c', '.'],
    ['(x) [y] *z*', '*'],
    ['line one\nline two', 'line'],
    ['emoji 👍 here 👍', '👍'],
    ['accents: café CAFÉ cafe', 'cafe'],
    ['Straße strasse STRASSE', 'strasse'],
    ['éé ee', 'ee'],
  ]) {
    assert.equal(joined(t, q), t, `${t} / ${q}`)
  }
})

test('characters that mean something in a pattern are plain text', () => {
  assert.deepEqual(marked('a.b and a+b and a*b', '.'), ['.'])
  assert.deepEqual(marked('(x) and [y]', '(x)'), ['(x)'])
})

test('the box marks with it, and matching uses the same folding', () => {
  const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
  const box = read('src/components/SearchDropdown.jsx')
  assert.ok(box.includes("import { highlightParts } from '../lib/highlight'"))
  assert.ok(box.includes('highlightParts(text, q).map('))
  assert.ok(!box.includes('toLowerCase'))
})

test('after skipping a start inside a character, the very next letter is tried (not a whole query further)', () => {
  // every letter here folds to "s", so the query "sß" is "sss" and matches at every place
  assert.deepEqual(highlightParts('sßßßSsßS', 'sß'), [
    { text: 'sß', match: true },
    { text: 'ßß', match: true },
    { text: 'Ssß', match: true },
    { text: 'S', match: false },
  ])
})
