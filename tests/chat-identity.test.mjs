// What keeps an open conversation from re-rendering every message for nothing:
// message objects that stay the same object until they change, and a typing
// indicator that sleeps until it has something to say.
//
//   node --test tests/chat-identity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shareMessages, sameMessages } from '../src/lib/messagesIdentity.js'
import { whoIsTyping, TYPING_TTL_MS } from '../src/lib/typing.js'

const msg = (id, over = {}) => ({ id, text: `hi ${id}`, ...over })
const ids = (...xs) => new Set(xs)

test('an unchanged message comes back as the very same object', () => {
  const first = shareMessages(new Map(), [msg('a'), msg('b')], ids('a', 'b'))
  const again = shareMessages(first.next, [msg('a'), msg('b')], ids())
  assert.equal(again.messages[0], first.messages[0])
  assert.equal(again.messages[1], first.messages[1])
  assert.equal(sameMessages(first.messages, again.messages), true)
})

test('only the message Firestore reported as changed is replaced', () => {
  const first = shareMessages(new Map(), [msg('a'), msg('b'), msg('c')], ids('a', 'b', 'c'))
  const edited = msg('b', { text: 'edited' })
  const again = shareMessages(first.next, [msg('a'), edited, msg('c')], ids('b'))
  assert.equal(again.messages[0], first.messages[0])
  assert.equal(again.messages[1], edited)
  assert.equal(again.messages[2], first.messages[2])
})

test('a new message at the end leaves the others alone', () => {
  const first = shareMessages(new Map(), [msg('a'), msg('b')], ids('a', 'b'))
  const fresh = msg('c')
  const again = shareMessages(first.next, [msg('a'), msg('b'), fresh], ids('c'))
  assert.equal(again.messages[0], first.messages[0])
  assert.equal(again.messages[1], first.messages[1])
  assert.equal(again.messages[2], fresh)
  assert.equal(sameMessages(first.messages, again.messages), false)
})

test('a message that slid out of the window is forgotten, not kept alive', () => {
  const first = shareMessages(new Map(), [msg('a'), msg('b')], ids('a', 'b'))
  const again = shareMessages(first.next, [msg('b'), msg('c')], ids('c'))
  assert.equal(again.next.has('a'), false)
  assert.equal(again.next.size, 2)
})

test('a message with no previous object is taken as it is, changed or not', () => {
  const doc = msg('a')
  assert.equal(shareMessages(new Map(), [doc], ids()).messages[0], doc)
})

test('order follows the new snapshot, not the old one', () => {
  const first = shareMessages(new Map(), [msg('a'), msg('b')], ids('a', 'b'))
  const again = shareMessages(first.next, [msg('b'), msg('a')], ids())
  assert.deepEqual(again.messages.map(m => m.id), ['b', 'a'])
})

// ---------- typing ----------

class Ts { constructor(ms) { this.ms = ms } toMillis() { return this.ms } }

test('nobody typing means nothing to wait for', () => {
  assert.deepEqual(whoIsTyping(undefined, 'me', 1000), { uids: [], expiresIn: null })
  assert.deepEqual(whoIsTyping({}, 'me', 1000), { uids: [], expiresIn: null })
})

test('someone who just typed counts, and says when they stop counting', () => {
  const r = whoIsTyping({ ana: new Ts(10_000) }, 'me', 12_000)
  assert.deepEqual(r.uids, ['ana'])
  assert.equal(r.expiresIn, TYPING_TTL_MS - 2000)
})

test('an entry older than the window no longer counts', () => {
  const r = whoIsTyping({ ana: new Ts(1000) }, 'me', 1000 + TYPING_TTL_MS)
  assert.deepEqual(r, { uids: [], expiresIn: null })
})

test('you are never counted as typing', () => {
  assert.deepEqual(whoIsTyping({ me: new Ts(1000) }, 'me', 1000), { uids: [], expiresIn: null })
})

test('with several people, the next change is the soonest expiry', () => {
  const r = whoIsTyping({ ana: new Ts(10_000), ben: new Ts(12_000) }, 'me', 13_000)
  assert.deepEqual(r.uids.sort(), ['ana', 'ben'])
  assert.equal(r.expiresIn, 10_000 + TYPING_TTL_MS - 13_000)
})

test('a write still waiting for its server time is ignored, as before', () => {
  assert.deepEqual(whoIsTyping({ ana: null }, 'me', 1000), { uids: [], expiresIn: null })
})
