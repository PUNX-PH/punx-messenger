// The phone folds text with a table generated from src/lib/fold.js (Dart has no Unicode normalisation).
// This fails when fold.js changes and the table was not regenerated:
//
//   node scripts/gen-fold-table.mjs     (writes the table and the list the phone's tests read)
//   node --test tests/fold-table.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { foldTableSource, foldCasesSource, TABLE_PATH, CASES_PATH } from '../scripts/gen-fold-table.mjs'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

test('the phone\'s fold table is what fold.js gives (run scripts/gen-fold-table.mjs if not)', () => {
  assert.equal(read(TABLE_PATH), foldTableSource())
})

test('the list the phone\'s tests check against is what fold.js gives (run scripts/gen-fold-table.mjs if not)', () => {
  assert.equal(read(CASES_PATH), foldCasesSource())
})

test('the table has what a search needs: accents, the special letters, capitals the phone\'s own Unicode is too old for', () => {
  const t = read(TABLE_PATH)
  assert.match(t, /0xe9: 'e',/) // é
  assert.match(t, /0xc9: 'e',/) // É
  assert.match(t, /0xdf: 'ss',/) // ß
  assert.match(t, /0x13a0: /) // a Cherokee capital that Dart does not lower-case
  assert.ok(!/0x(41|61): /.test(t), 'no ASCII')
  assert.ok(!/0x(300|301): /.test(t), 'marks are in the ranges, not the table')
  assert.match(t, /foldMarkRanges = \[\n  0x300, 0x36f,/)
})

test('the phone folds with it and nothing else (pinned against the source)', () => {
  const s = read('android_app/lib/utils/fold.dart')
  assert.ok(s.includes("import 'fold_table.dart';"))
  assert.ok(s.includes('foldTable[rune] ?? String.fromCharCode(rune)'))
  assert.ok(!s.includes('toLowerCase()') || s.includes('return s.toLowerCase();'), "no Dart toLowerCase on a non-ASCII character (its Unicode data is older)")
})
