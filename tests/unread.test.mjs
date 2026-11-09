// What counts as unread, and the number shown in the browser tab.
//
//   node --test tests/unread.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countUnread, dmConvoId, isUnread, pathToReadKey, readKeyForRoute, titleWithCount,
} from '../src/lib/unread.js'

const ts = (ms) => ({ toMillis: () => ms })
const dm = (id, at, author = 'ana') => ({ id, lastMessageAt: ts(at), lastMessageAuthorUid: author })
const ch = (id, at) => ({ id, lastMessageAt: ts(at) })
const key = (p) => pathToReadKey(p)
const count = (o) => countUnread({ meUid: 'me', ...o })

test('isUnread: newer than the last read means unread; nothing recorded means not', () => {
  assert.equal(isUnread(ts(200), ts(100)), true)
  assert.equal(isUnread(ts(100), ts(100)), false)
  assert.equal(isUnread(ts(100), ts(200)), false)
  assert.equal(isUnread(ts(100), undefined), true, 'never read')
  assert.equal(isUnread(undefined, ts(100)), false, 'no messages')
  assert.equal(isUnread(null, null), false)
})

test('keys are the same as the container paths, with slashes turned into __', () => {
  assert.equal(pathToReadKey('groups/g/channels/c'), 'groups__g__channels__c')
  assert.equal(dmConvoId('b', 'a'), 'a__b')
  assert.equal(dmConvoId('a', 'b'), dmConvoId('b', 'a'))
})

test('nothing new: zero', () => {
  assert.equal(count({}), 0)
  assert.equal(count({ dmConvos: [dm('a__me', 100)], lastRead: { [key('dms/a__me')]: ts(100) } }), 0)
})

test('counts conversations, not messages, across DMs and channels', () => {
  const n = count({
    dmConvos: [dm('a__me', 500), dm('b__me', 500)],
    channelsByGroup: { g1: [ch('c1', 500), ch('c2', 500)], g2: [ch('c3', 500)] },
    lastRead: {},
  })
  assert.equal(n, 5)
})

test('a conversation already read does not count; a newer message in it does', () => {
  const lastRead = { [key('groups/g1/channels/c1')]: ts(500) }
  assert.equal(count({ channelsByGroup: { g1: [ch('c1', 400)] }, lastRead }), 0)
  assert.equal(count({ channelsByGroup: { g1: [ch('c1', 600)] }, lastRead }), 1)
})

test('muted groups do not count, others still do', () => {
  const channelsByGroup = { quiet: [ch('c1', 500)], loud: [ch('c2', 500)] }
  assert.equal(count({ channelsByGroup, mutedGroups: new Set(['quiet']) }), 1)
  assert.equal(count({ channelsByGroup, mutedGroups: new Set(['quiet', 'loud']) }), 0)
})

test('the conversation you are looking at is left out', () => {
  const channelsByGroup = { g1: [ch('c1', 500), ch('c2', 500)] }
  assert.equal(count({ channelsByGroup, lookingAt: key('groups/g1/channels/c1') }), 1)
  assert.equal(count({ channelsByGroup, lookingAt: null }), 2, 'not looking: it counts')
  assert.equal(count({ dmConvos: [dm('a__me', 500)], lookingAt: key('dms/a__me') }), 0)
})

test('a DM whose last message is your own, or that was only opened, does not count', () => {
  assert.equal(count({ dmConvos: [dm('a__me', 500, 'me')] }), 0)
  assert.equal(count({ dmConvos: [{ id: 'a__me', lastMessageAt: ts(500) }] }), 0, 'no author: opened, never written in')
  assert.equal(count({ dmConvos: [dm('a__me', 500, 'ana')] }), 1)
})

test('a group with no channels loaded yet counts nothing and does not break', () => {
  assert.equal(count({ channelsByGroup: { g1: undefined, g2: [] } }), 0)
})

test('route to read key: DMs, channels, and pages that are neither', () => {
  assert.equal(readKeyForRoute('/dms/ana', 'me'), key('dms/ana__me'))
  assert.equal(readKeyForRoute('/dms/ana/', 'me'), key('dms/ana__me'))
  assert.equal(readKeyForRoute('/g/g1/c/c2', 'me'), key('groups/g1/channels/c2'))
  for (const p of ['/', '/dms', '/me/notes', '/g/g1', '/admin', '/invite/abc', '/g/g1/c/c2/extra', undefined]) {
    assert.equal(readKeyForRoute(p, 'me'), null, String(p))
  }
  assert.equal(readKeyForRoute('/dms/ana', undefined), null, 'nobody signed in')
})

test('the key for the DM you are in matches the key its unread state is stored under', () => {
  const lookingAt = readKeyForRoute('/dms/ana', 'me')
  assert.equal(count({ dmConvos: [dm(dmConvoId('me', 'ana'), 500)], lookingAt }), 0)
})

test('the tab title: unchanged at zero, a count otherwise, capped at 99+', () => {
  assert.equal(titleWithCount('Punx Messenger', 0), 'Punx Messenger')
  assert.equal(titleWithCount('Punx Messenger', undefined), 'Punx Messenger')
  assert.equal(titleWithCount('Punx Messenger', -2), 'Punx Messenger')
  assert.equal(titleWithCount('Punx Messenger', 3), '(3) Punx Messenger')
  assert.equal(titleWithCount('Punx Messenger', 99), '(99) Punx Messenger')
  assert.equal(titleWithCount('Punx Messenger', 100), '(99+) Punx Messenger')
})

test('needsMarkRead: only when there is something newer than what was read', async () => {
  const { needsMarkRead } = await import('../src/lib/unread.js')
  assert.equal(needsMarkRead(ts(500), ts(400)), true, 'a newer message')
  assert.equal(needsMarkRead(ts(500), ts(500)), false, 'read up to it')
  assert.equal(needsMarkRead(ts(500), ts(900)), false, 'read after it')
  assert.equal(needsMarkRead(ts(500), undefined), true, 'never read')
  assert.equal(needsMarkRead(null, ts(900)), true, 'a message still being sent has no time yet')
  assert.equal(needsMarkRead(undefined, undefined), true, 'an empty conversation keeps the old behaviour')
})
