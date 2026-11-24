// Folding text for searching: no capitals, no accents.
//
//   node --test tests/fold.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fold, foldIndexed } from '../src/lib/fold.js'

test('capitals go', () => {
  assert.equal(fold('Hello WORLD'), 'hello world')
  assert.equal(fold('MiXeD 123 !?'), 'mixed 123 !?')
})

test('accents go, from capitals and small letters alike', () => {
  assert.equal(fold('Café'), 'cafe')
  assert.equal(fold('JOSÉ'), 'jose')
  assert.equal(fold('Ñandú'), 'nandu')
  assert.equal(fold('crème brûlée'), 'creme brulee')
  assert.equal(fold('Zoë Ångström'), 'zoe angstrom')
  assert.equal(fold('Łódź Đà Nẵng'), 'lodz da nang')
})

test('letters that are not a letter and a mark: written the plain way', () => {
  assert.equal(fold('Straße'), 'strasse')
  assert.equal(fold('Æon œuvre'), 'aeon oeuvre')
  assert.equal(fold('Øresund'), 'oresund')
  assert.equal(fold('ıI'), 'ii')
})

test('a letter and its mark written as two characters folds the same as the one-character form', () => {
  const composed = 'é' // é
  const decomposed = 'é' // e + acute
  assert.equal(fold(composed), 'e')
  assert.equal(fold(decomposed), 'e')
  assert.equal(fold('caf' + decomposed), fold('caf' + composed))
})

test('a mark on its own folds to nothing', () => {
  assert.equal(fold('́'), '')
  assert.equal(fold('á̂b'), 'ab')
})

test('other alphabets keep their letters, and are only made lower case', () => {
  assert.equal(fold('ПРИВЕТ'), 'привет')
  assert.equal(fold('東京'), '東京')
  assert.equal(fold('Ελλάδα'), 'ελλαδα') // the accent goes, as for any letter
  assert.equal(fold('👍 ok'), '👍 ok')
})

test('Korean syllables stay as they are (and are found by themselves)', () => {
  assert.equal(fold('한국어'), '한국어')
  assert.equal(fold('가').length, 1)
  assert.deepEqual(foldIndexed('한국'), { text: '한국', starts: [0, 1], ends: [1, 2] })
})

test('the same word is the same folded however the capital sigma sits (no word-end rule)', () => {
  assert.equal(fold('ΟΔΟΣ'), fold('οδοσ'))
  assert.equal(fold('οδος'), fold('οδοσ')) // final sigma = sigma
})

test('nothing, or not a string, is empty', () => {
  assert.equal(fold(''), '')
  assert.equal(fold(null), '')
  assert.equal(fold(undefined), '')
  assert.equal(fold(42), '42')
})

test('foldIndexed gives the same text as fold, for every kind of input', () => {
  for (const t of ['', 'abc', 'Café', 'Straße', 'éx', '́', 'ΟΔΟΣ', '👍a👍', 'Æ Ø Đ', 'ПРИВЕТ']) {
    assert.equal(foldIndexed(t).text, fold(t), JSON.stringify(t))
  }
})

test('foldIndexed says where each letter came from', () => {
  // plain: one to one
  assert.deepEqual(foldIndexed('ab'), { text: 'ab', starts: [0, 1], ends: [1, 2] })
  // ß gives two letters from one character
  assert.deepEqual(foldIndexed('aßb'), { text: 'assb', starts: [0, 1, 1, 2], ends: [1, 2, 2, 3] })
  // a letter and its mark as two characters: one letter, from the letter alone ... and the mark gives none
  const r = foldIndexed('éx')
  assert.equal(r.text, 'ex')
  assert.deepEqual(r.starts, [0, 2])
  assert.deepEqual(r.ends, [1, 3])
})

test('foldIndexed counts an emoji (two code units) as one character', () => {
  const r = foldIndexed('a👍b')
  assert.equal(r.text, 'a👍b')
  assert.deepEqual(r.starts, [0, 1, 1, 3])
  assert.deepEqual(r.ends, [1, 3, 3, 4])
})
