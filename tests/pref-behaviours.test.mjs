// The things a preference changes in how a conversation reads and sends: grouping
// messages under one name, the clock, and which key sends.
//
//   node --test tests/pref-behaviours.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBlocks, toDate } from '../src/lib/messageBlocks.js'
import { clockTime, fullTime, headerTime } from '../src/lib/timeFormat.js'
import { shouldSend } from '../src/lib/sendKey.js'

// ---------- grouping ----------

const at = (iso) => ({ toDate: () => new Date(iso) })
let n = 0
const msg = (uid, iso, id) => ({ id: id ?? `m${++n}`, author: { uid }, createdAt: iso === null ? null : at(iso) })
const shape = (blocks) => blocks.map(b => (b.type === 'day' ? 'day' : b.items.map(m => m.id).join('+')))

test('by default, messages by one person within 5 minutes share a group', () => {
  const m1 = msg('a', '2026-11-09T10:00:00'), m2 = msg('a', '2026-11-09T10:04:00'), m3 = msg('a', '2026-11-09T10:10:00')
  assert.deepEqual(shape(buildBlocks([m1, m2, m3])), ['day', `${m1.id}+${m2.id}`, m3.id])
})

test('a different person always starts a new group', () => {
  const m1 = msg('a', '2026-11-09T10:00:00'), m2 = msg('b', '2026-11-09T10:00:30'), m3 = msg('a', '2026-11-09T10:01:00')
  assert.deepEqual(shape(buildBlocks([m1, m2, m3])), ['day', m1.id, m2.id, m3.id])
})

test('the window is the person\'s choice: 2 minutes, 15 minutes, or never', () => {
  const m1 = msg('a', '2026-11-09T10:00:00'), m2 = msg('a', '2026-11-09T10:03:00'), m3 = msg('a', '2026-11-09T10:12:00')
  assert.deepEqual(shape(buildBlocks([m1, m2, m3], 2)), ['day', m1.id, m2.id, m3.id], '3 minutes apart is too far for 2')
  assert.deepEqual(shape(buildBlocks([m1, m2, m3], 5)), ['day', `${m1.id}+${m2.id}`, m3.id])
  assert.deepEqual(shape(buildBlocks([m1, m2, m3], 15)), ['day', `${m1.id}+${m2.id}+${m3.id}`], '12 minutes fits in 15')
  assert.deepEqual(shape(buildBlocks([m1, m2, m3], 0)), ['day', m1.id, m2.id, m3.id], 'never: every message on its own')
})

test('"never" still puts a message with no name under its own day divider', () => {
  const a = msg('a', '2026-11-09T10:00:00'), b = msg('a', '2026-11-10T10:00:01')
  assert.deepEqual(shape(buildBlocks([a, b], 0)), ['day', a.id, 'day', b.id])
})

test('a group never straddles midnight, whatever the window', () => {
  const a = msg('a', '2026-11-09T23:59:00'), b = msg('a', '2026-11-10T00:01:00')
  assert.deepEqual(shape(buildBlocks([a, b], 15)), ['day', a.id, 'day', b.id])
})

test('a message still being sent (no time yet) joins the same person\'s group and the day on screen', () => {
  const a = msg('a', '2026-11-09T10:00:00'), pending = msg('a', null)
  assert.deepEqual(shape(buildBlocks([a, pending])), ['day', `${a.id}+${pending.id}`])
  assert.deepEqual(shape(buildBlocks([a, pending], 0)), ['day', a.id, pending.id], 'but not when grouping is off')
})

test('group keys are the first message\'s id, so loading older ones does not remount the rest', () => {
  const a = msg('a', '2026-11-09T10:00:00', 'first'), b = msg('a', '2026-11-09T10:01:00', 'second')
  assert.equal(buildBlocks([a, b]).find(x => x.type === 'group').key, 'first')
})

test('no messages, and nonsense windows, are safe', () => {
  assert.deepEqual(buildBlocks([]), [])
  assert.deepEqual(buildBlocks(undefined), [])
  const a = msg('a', '2026-11-09T10:00:00'), b = msg('a', '2026-11-09T10:01:00')
  assert.deepEqual(shape(buildBlocks([a, b], -5)), ['day', a.id, b.id], 'negative is treated as never')
})

test('toDate understands Firestore timestamps, dates, and nothing', () => {
  assert.equal(toDate(null), null)
  assert.equal(toDate(undefined), null)
  assert.equal(toDate('2026-11-09'), null)
  const d = new Date('2026-11-09T10:00:00')
  assert.equal(toDate(d), d)
  assert.equal(toDate({ toDate: () => d }), d)
})

// ---------- clocks ----------

const evening = new Date(2026, 10, 9, 21, 5)   // 9:05 pm
const morning = new Date(2026, 10, 9, 9, 7)    // 9:07 am
const midnight = new Date(2026, 10, 9, 0, 30)
const US = 'en-US'

test('12-hour: the header has AM/PM, the gutter time does not', () => {
  assert.equal(headerTime(evening, '12h', US), '9:05 PM')
  assert.equal(headerTime(morning, '12h', US), '9:07 AM')
  assert.equal(clockTime(evening, '12h', US), '9:05')
  assert.equal(clockTime(morning, '12h', US), '9:07')
})

test('24-hour: the same time, on a 24-hour clock, in both places', () => {
  assert.equal(headerTime(evening, '24h', US), '21:05')
  assert.equal(clockTime(evening, '24h', US), '21:05')
  assert.equal(clockTime(morning, '24h', US), '09:07')
  assert.equal(clockTime(midnight, '24h', US), '00:30', 'half past midnight is 00:30, not 24:30')
})

test('automatic follows the locale, as before', () => {
  assert.equal(headerTime(evening, 'auto', 'en-US'), '9:05 PM')
  assert.equal(headerTime(evening, 'auto', 'en-GB'), '21:05')
  assert.equal(clockTime(evening, 'auto', 'en-GB'), '21:05')
  assert.equal(clockTime(evening, undefined, 'en-US'), '9:05', 'no choice given: automatic')
})

test('the tooltip carries the full date and the chosen clock', () => {
  assert.match(fullTime(evening, '12h', US), /November 9, 2026/)
  assert.match(fullTime(evening, '12h', US), /9:05\s?PM/)
  assert.match(fullTime(evening, '24h', US), /21:05/)
  assert.doesNotMatch(fullTime(evening, '24h', US), /PM/)
})

test('no date, no time', () => {
  for (const f of [clockTime, headerTime, fullTime]) {
    assert.equal(f(null, '12h'), '')
    assert.equal(f(undefined, '24h'), '')
  }
})

// ---------- which key sends ----------

const key = (over) => ({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...over })

test('Enter sends, Shift+Enter makes a new line (the default)', () => {
  assert.equal(shouldSend(key(), 'enter'), true)
  assert.equal(shouldSend(key({ shiftKey: true }), 'enter'), false)
  assert.equal(shouldSend(key()), true, 'no choice given: the default')
})

test('with Ctrl+Enter chosen, only Ctrl or Cmd with Enter sends and plain Enter is a new line', () => {
  assert.equal(shouldSend(key(), 'mod-enter'), false)
  assert.equal(shouldSend(key({ shiftKey: true }), 'mod-enter'), false)
  assert.equal(shouldSend(key({ ctrlKey: true }), 'mod-enter'), true)
  assert.equal(shouldSend(key({ metaKey: true }), 'mod-enter'), true)
})

test('other keys never send', () => {
  for (const mode of ['enter', 'mod-enter']) {
    for (const k of ['a', 'Tab', 'Escape', ' ', 'ArrowDown']) {
      assert.equal(shouldSend(key({ key: k, ctrlKey: true }), mode), false, `${mode} ${k}`)
    }
  }
})

test('Enter while an input method is composing (confirming a candidate) never sends, in either mode', () => {
  assert.equal(shouldSend(key({ isComposing: true }), 'enter'), false)
  assert.equal(shouldSend(key({ isComposing: true, ctrlKey: true }), 'mod-enter'), false)
  assert.equal(shouldSend({ key: 'Enter', nativeEvent: { isComposing: true } }, 'enter'), false, 'the React synthetic event form')
  assert.equal(shouldSend({ key: 'Enter', nativeEvent: { isComposing: false } }, 'enter'), true)
})
