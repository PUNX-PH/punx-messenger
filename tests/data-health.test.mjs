// The record of which live data feeds have failed, behind the "couldn't keep X up
// to date" banner.
//
//   node --test tests/data-health.test.mjs
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  reportDataError, reportDataOk, clearDataProblems, getDataProblems,
  subscribeDataProblems, watched, describeProblems,
} from '../src/lib/dataHealth.js'

beforeEach(() => clearDataProblems())

// Silence the console.error that `watched` writes on purpose.
const quiet = (fn) => { const e = console.error; console.error = () => {}; try { return fn() } finally { console.error = e } }

test('nothing is wrong until something reports', () => {
  assert.deepEqual(getDataProblems(), [])
})

test('an error is recorded with its label and normalised code', () => {
  reportDataError('people', 'people', { code: 'firestore/permission-denied' })
  assert.deepEqual(getDataProblems(), [{ key: 'people', label: 'people', code: 'permission-denied' }])
})

test('the same failure reported again changes nothing, not even the array', () => {
  reportDataError('people', 'people', { code: 'unavailable' })
  const first = getDataProblems()
  let calls = 0
  const off = subscribeDataProblems(() => calls++)
  reportDataError('people', 'people', { code: 'unavailable' })
  off()
  assert.equal(getDataProblems(), first, 'React compares this by identity')
  assert.equal(calls, 0)
})

test('a success clears only its own feed', () => {
  reportDataError('a', 'groups', { code: 'x' })
  reportDataError('b', 'people', { code: 'x' })
  reportDataOk('a')
  assert.deepEqual(getDataProblems().map(p => p.key), ['b'])
})

test('a success for a feed that never failed tells nobody', () => {
  let calls = 0
  const off = subscribeDataProblems(() => calls++)
  reportDataOk('never-failed')
  off()
  assert.equal(calls, 0)
})

test('subscribers hear about each change, and stop after unsubscribing', () => {
  let calls = 0
  const off = subscribeDataProblems(() => calls++)
  reportDataError('a', 'groups', {})
  reportDataOk('a')
  assert.equal(calls, 2)
  off()
  reportDataError('a', 'groups', {})
  assert.equal(calls, 2)
})

test('clearing drops everything, once', () => {
  reportDataError('a', 'groups', {})
  reportDataError('b', 'people', {})
  let calls = 0
  const off = subscribeDataProblems(() => calls++)
  clearDataProblems()
  clearDataProblems()
  off()
  assert.deepEqual(getDataProblems(), [])
  assert.equal(calls, 1)
})

test('watched: the error callback records, the next callback passes data through and clears', () => {
  const seen = []
  const [next, error] = watched('your groups', (v) => { seen.push(v); return 'r' })
  quiet(() => error({ code: 'permission-denied' }))
  assert.equal(getDataProblems().length, 1)
  assert.equal(next('data'), 'r')
  assert.deepEqual(seen, ['data'])
  assert.deepEqual(getDataProblems(), [])
})

test('watched: feeds of the same kind with different keys are kept apart', () => {
  const [, errA] = watched('this group', () => {}, 'group:a')
  const [, errB] = watched('this group', () => {}, 'group:b')
  quiet(() => { errA({ code: 'x' }); errB({ code: 'x' }) })
  assert.equal(getDataProblems().length, 2)
})

test('the banner sentence names each feed once, and warns about lost access', () => {
  assert.equal(describeProblems([]), '')
  assert.match(describeProblems([{ label: 'people', code: 'unavailable' }]), /keep people up to date/)
  const two = describeProblems([{ label: 'people', code: 'x' }, { label: 'your groups', code: 'x' }])
  assert.match(two, /people and your groups/)
  const three = describeProblems([{ label: 'a', code: 'x' }, { label: 'b', code: 'x' }, { label: 'c', code: 'x' }])
  assert.match(three, /a, b and c/)
  const dup = describeProblems([{ label: 'this group', code: 'x' }, { label: 'this group', code: 'x' }])
  assert.equal((dup.match(/this group/g) || []).length, 1)
  assert.doesNotMatch(describeProblems([{ label: 'people', code: 'unavailable' }]), /access/)
  assert.match(describeProblems([{ label: 'people', code: 'permission-denied' }]), /no longer have access/)
})
