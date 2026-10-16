// What the chat says when its Firestore listener fails.
//
//   node --test tests/listen-error.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeListenError } from '../src/lib/listenError.js'

test('no access says so, and trying again is not offered', () => {
  const r = describeListenError({ code: 'permission-denied' })
  assert.match(r.message, /don't have access/)
  assert.equal(r.retryable, false)
})

test('a missing index is reported as setup, not as a connection problem', () => {
  const r = describeListenError({ code: 'failed-precondition' })
  assert.match(r.message, /index/)
  assert.equal(r.retryable, false)
})

test('a network failure can be retried', () => {
  for (const code of ['unavailable', 'deadline-exceeded', 'cancelled']) {
    const r = describeListenError({ code })
    assert.match(r.message, /reach the server/)
    assert.equal(r.retryable, true, code)
  }
})

test('the "firestore/" prefix some SDK paths add is ignored', () => {
  assert.equal(describeListenError({ code: 'firestore/permission-denied' }).retryable, false)
})

test('anything else gets a generic message and a retry', () => {
  for (const err of [{ code: 'internal' }, { message: 'boom' }, null, undefined, {}]) {
    const r = describeListenError(err)
    assert.equal(r.retryable, true)
    assert.match(r.message, /couldn't be loaded/)
  }
})

test('the raw error text never reaches the person', () => {
  const r = describeListenError({ code: 'internal', message: 'INTERNAL ASSERTION FAILED: secret detail' })
  assert.doesNotMatch(r.message, /ASSERTION|secret/)
})
