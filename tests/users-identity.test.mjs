// What keeps the app from re-rendering on every heartbeat: a person's object must
// stay the SAME object until something the UI shows has changed.
//
//   node --test tests/users-identity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identityOf, presenceOf, sameUsers, shareIdentity } from '../src/lib/usersIdentity.js'

// A stand-in for a Firestore Timestamp: two of them holding the same instant are
// different objects, which is exactly what each snapshot hands us.
class Ts { constructor(ms) { this.ms = ms } toMillis() { return this.ms } }

const ana = (over = {}) => ({
  id: 'ana', name: 'Ana', email: 'ana@punx.ai', role: 'employee', photoURL: 'a.png',
  createdAt: new Ts(1000), presence: 'online', lastSeen: new Ts(5000),
  lastRead: { c1: new Ts(10) }, ...over,
})
const ben = (over = {}) => ({
  id: 'ben', name: 'Ben', email: 'ben@punx.ai', role: 'admin', createdAt: new Ts(2000),
  presence: 'away', lastSeen: new Ts(6000), lastRead: { c1: new Ts(20) }, ...over,
})
const run = (prev, list, me = 'ana') => shareIdentity(prev, list, me)

test('identityOf drops presence and lastSeen, which change by themselves', () => {
  const id = identityOf(ana())
  assert.equal('presence' in id, false)
  assert.equal('lastSeen' in id, false)
  assert.equal(id.name, 'Ana')
})

test("lastRead is noise for other people but must stay live for me", () => {
  assert.equal('lastRead' in identityOf(ben(), false), false)
  assert.ok('lastRead' in identityOf(ana(), true), 'my own unread badges depend on it')
})

test('presenceOf is only the presence slice', () => {
  assert.deepEqual(Object.keys(presenceOf(ana())).sort(), ['lastSeen', 'presence'])
})

test('a heartbeat changes nothing a consumer can see: same objects, same array', () => {
  const first = run(new Map(), [ana(), ben()])
  // Both people's lastSeen moves; presence flips for Ben.
  const second = run(first.next, [
    ana({ lastSeen: new Ts(50_000) }),
    ben({ lastSeen: new Ts(51_000), presence: 'online' }),
  ])
  assert.equal(second.users[0], first.users[0])
  assert.equal(second.users[1], first.users[1])
  assert.ok(sameUsers(first.users, second.users), 'so the provider can skip setState entirely')
})

test('...but the presence map does carry the new values', () => {
  const first = run(new Map(), [ana(), ben()])
  const second = run(first.next, [ana(), ben({ lastSeen: new Ts(51_000), presence: 'online' })])
  assert.equal(second.presence.ben.presence, 'online')
  assert.equal(second.presence.ben.lastSeen.toMillis(), 51_000)
  assert.equal(first.presence.ben.presence, 'away', 'and the old map is untouched')
})

test("someone else reading a channel is not news", () => {
  const first = run(new Map(), [ana(), ben()])
  const second = run(first.next, [ana(), ben({ lastRead: { c1: new Ts(99), c2: new Ts(99) } })])
  assert.ok(sameUsers(first.users, second.users))
})

test('but MY reading a channel is: my badges must update', () => {
  const first = run(new Map(), [ana(), ben()])
  const second = run(first.next, [ana({ lastRead: { c1: new Ts(10), c2: new Ts(77) } }), ben()])
  assert.notEqual(second.users[0], first.users[0], 'my object changes')
  assert.equal(second.users[1], first.users[1], 'and only mine')
  assert.ok(second.users[0].lastRead.c2, 'carrying the new entry')
})

test('a name, photo or role change replaces exactly that person', () => {
  const first = run(new Map(), [ana(), ben()])
  for (const change of [{ name: 'Anna' }, { photoURL: 'b.png' }, { role: 'super_admin' }]) {
    const second = run(first.next, [ana(change), ben()])
    assert.notEqual(second.users[0], first.users[0], JSON.stringify(change))
    assert.equal(second.users[1], first.users[1], 'Ben is untouched')
  }
})

test('being deactivated, or reactivated, is a change', () => {
  const first = run(new Map(), [ana(), ben()])
  const out = run(first.next, [ana(), ben({ deactivated: true })])
  assert.notEqual(out.users[1], first.users[1])
  assert.equal(out.users[1].deactivated, true)
  const back = run(out.next, [ana(), ben()])
  assert.notEqual(back.users[1], out.users[1], 'reactivating clears the field and is seen')
  assert.equal('deactivated' in back.users[1], false)
})

test('equal timestamps held in different objects are the same value', () => {
  const first = run(new Map(), [ana({ createdAt: new Ts(1000) })])
  const second = run(first.next, [ana({ createdAt: new Ts(1000) })])
  assert.equal(second.users[0], first.users[0])
})

test('field order in the document does not matter', () => {
  const a = { id: 'x', name: 'X', role: 'employee', email: 'x@punx.ai' }
  const b = { email: 'x@punx.ai', role: 'employee', id: 'x', name: 'X' }
  const first = run(new Map(), [a])
  assert.equal(run(first.next, [b]).users[0], first.users[0])
})

test('people joining and leaving the list are handled', () => {
  const first = run(new Map(), [ana(), ben()])
  const gone = run(first.next, [ben()])
  assert.deepEqual(gone.users.map(u => u.id), ['ben'])
  assert.equal(gone.users[0], first.users[1], 'Ben keeps his identity')
  assert.equal(gone.next.has('ana'), false, 'nothing leaks for people who left')
  const cal = { id: 'cal', name: 'Cal', role: 'guest' }
  const more = run(gone.next, [ben(), cal])
  assert.equal(more.users.length, 2)
  assert.equal(sameUsers(gone.users, more.users), false)
})

test('a new order of the same people is not "the same users"', () => {
  const first = run(new Map(), [ana(), ben()])
  const second = run(first.next, [ben(), ana()])
  assert.equal(sameUsers(first.users, second.users), false, 'the list is sorted by name; order is visible')
})

test('the volatile fields cannot leak back in through an identity', () => {
  // Anyone who still reads `.presence` off a user object must get nothing, not a
  // value frozen at whenever that object was first created.
  const first = run(new Map(), [ana()])
  assert.equal(first.users[0].presence, undefined)
  assert.equal(first.users[0].lastSeen, undefined)
})

test('the signed-in user changing between snapshots is handled', () => {
  const first = shareIdentity(new Map(), [ana(), ben()], 'ana')
  // Now Ben is "me": his lastRead must be kept, Ana's dropped.
  const second = shareIdentity(first.next, [ana(), ben()], 'ben')
  assert.equal('lastRead' in second.users[0], false)
  assert.equal('lastRead' in second.users[1], true)
})

test('a large directory is cheap to process', () => {
  const list = Array.from({ length: 2000 }, (_, i) => ({
    id: `u${i}`, name: `User ${i}`, role: 'employee', presence: 'online', lastSeen: new Ts(i),
  }))
  const first = run(new Map(), list, 'u0')
  const started = performance.now()
  const second = run(first.next, list.map(u => ({ ...u, lastSeen: new Ts(u.lastSeen.ms + 1) })), 'u0')
  const ms = performance.now() - started
  assert.ok(sameUsers(first.users, second.users))
  assert.ok(ms < 250, `2000 heartbeats processed in ${ms.toFixed(0)}ms`)
})
