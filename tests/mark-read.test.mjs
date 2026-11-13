// "Mark as read" for one DM, for all DMs, and for everything: what counts as unread, how the
// keys are batched, and that each way in is wired.
//
//   node --test tests/mark-read.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chunkKeys, countUnread, pathToReadKey, unreadKeys } from '../src/lib/unread.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (f) => lf(fs.readFileSync(f, 'utf8'))
const ts = (ms) => ({ toMillis: () => ms })
const dm = (id, at, author = 'ana') => ({ id, lastMessageAt: ts(at), lastMessageAuthorUid: author })
const ch = (id, at) => ({ id, lastMessageAt: ts(at) })
const key = (p) => pathToReadKey(p)

// ---------- what is unread ----------

test('a DM is unread when its last message is newer than when you last read it', () => {
  const r = unreadKeys({ dmConvos: [dm('d1', 200), dm('d2', 100), dm('d3', 50)], lastRead: { [key('dms/d1')]: ts(100), [key('dms/d2')]: ts(100), [key('dms/d3')]: ts(500) } })
  assert.deepEqual(r.dms, ['dms__d1'])
  assert.deepEqual(r.channels, [])
})

test('a channel is unread the same way, in any group', () => {
  const r = unreadKeys({
    channelsByGroup: { g1: [ch('a', 300), ch('b', 100)], g2: [ch('c', 400)] },
    lastRead: { [key('groups/g1/channels/a')]: ts(100), [key('groups/g1/channels/b')]: ts(100) },
  })
  assert.deepEqual(r.channels.sort(), ['groups__g1__channels__a', 'groups__g2__channels__c'])
})

test('never read at all counts as unread when there is something in it, and an empty one does not', () => {
  const r = unreadKeys({ dmConvos: [dm('d1', 10), { id: 'd2', lastMessageAt: null }], channelsByGroup: { g: [ch('a', 10), { id: 'b' }] }, lastRead: {} })
  assert.deepEqual(r.dms, ['dms__d1'])
  assert.deepEqual(r.channels, ['groups__g__channels__a'])
})

test('a muted group\'s channels are cleared too, and so is a DM whose last message is yours', () => {
  // countUnread leaves both out of the badge; but both show a dot, so "mark as read" must clear them.
  const input = { dmConvos: [dm('mine', 200, 'me')], channelsByGroup: { quiet: [ch('x', 200)] }, lastRead: {}, mutedGroups: new Set(['quiet']), meUid: 'me' }
  assert.equal(countUnread(input), 0)
  const r = unreadKeys(input)
  assert.deepEqual(r.dms, ['dms__mine'])
  assert.deepEqual(r.channels, ['groups__quiet__channels__x'])
})

test('everything the badge counts is cleared by "mark all" (it can only be wider)', () => {
  const scenarios = [
    { dmConvos: [dm('a', 5), dm('b', 5, 'me'), { id: 'c', lastMessageAt: ts(5) }], channelsByGroup: { g: [ch('x', 9), ch('y', 1)], h: [] }, lastRead: { [key('groups/g/channels/y')]: ts(5) } },
    { dmConvos: [], channelsByGroup: { g: [ch('x', 9)] }, lastRead: {} },
    { dmConvos: [dm('a', 5)], channelsByGroup: {}, lastRead: { [key('dms/a')]: ts(9) } },
    { dmConvos: [dm('a', 5), dm('b', 6)], channelsByGroup: { g: [ch('x', 9), ch('y', 9)] }, lastRead: { [key('dms/a')]: ts(1), [key('groups/g/channels/x')]: ts(1) } },
  ]
  for (const sc of scenarios) {
    const input = { ...sc, mutedGroups: new Set(), meUid: 'me' }
    const keys = unreadKeys(input)
    assert.ok(keys.dms.length + keys.channels.length >= countUnread(input), JSON.stringify(sc))
  }
})

test('after marking everything it finds nothing left to mark', () => {
  const input = { dmConvos: [dm('a', 5), dm('b', 6)], channelsByGroup: { g: [ch('x', 9)] }, lastRead: {} }
  const { dms, channels } = unreadKeys(input)
  const after = Object.fromEntries([...dms, ...channels].map((k) => [k, ts(1000)]))
  assert.deepEqual(unreadKeys({ ...input, lastRead: after }), { dms: [], channels: [] })
})

test('missing or odd input gives nothing, never a crash', () => {
  assert.deepEqual(unreadKeys(), { dms: [], channels: [] })
  assert.deepEqual(unreadKeys({}), { dms: [], channels: [] })
  assert.deepEqual(unreadKeys({ dmConvos: null, channelsByGroup: null, lastRead: null }), { dms: [], channels: [] })
  assert.deepEqual(unreadKeys({ channelsByGroup: { g: null } }), { dms: [], channels: [] })
})

// ---------- batching ----------

test('keys are de-duplicated and cut into pieces of a safe size', () => {
  assert.deepEqual(chunkKeys(['a', 'b', 'a', 'c'], 2), [['a', 'b'], ['c']])
  assert.deepEqual(chunkKeys(['a', 'b', 'c'], 3), [['a', 'b', 'c']])
  assert.deepEqual(chunkKeys([]), [])
  assert.deepEqual(chunkKeys(undefined), [])
  const many = Array.from({ length: 650 }, (_, i) => `k${i}`)
  const pieces = chunkKeys(many)
  assert.deepEqual(pieces.map((p) => p.length), [300, 300, 50])
  assert.deepEqual(pieces.flat(), many, 'nothing lost, nothing repeated, same order')
})

test('a bad size falls back to the default rather than looping or dropping keys', () => {
  const keys = Array.from({ length: 10 }, (_, i) => `k${i}`)
  for (const bad of [0, -3, 1.5, NaN, undefined, null, '5']) assert.deepEqual(chunkKeys(keys, bad).flat(), keys, String(bad))
})

// ---------- the write ----------

test('the write touches only lastRead.<key> on the person\'s own profile, one update per piece', () => {
  const db = read('src/lib/db.js')
  // Just this function: up to the next one in the file.
  const start = db.indexOf('export async function markManyRead')
  const fn = db.slice(start, db.indexOf('\nexport ', start + 10))
  assert.ok(fn.includes('if (!uid) return\n'), 'nobody signed in: nothing to write')
  assert.ok(fn.includes('for (const piece of chunkKeys(keys)) {'), 'in pieces, not all at once')
  assert.ok(fn.includes('fields[`lastRead.${key}`] = serverTimestamp()'))
  assert.ok(fn.includes("await updateDoc(doc(db, 'users', uid), fields)"))
  assert.ok(!/setDoc|deleteDoc|arrayUnion/.test(fn), 'nothing but updates to lastRead')
  assert.ok(db.includes("import { chunkKeys, dmConvoId, isUnread, pathToReadKey } from './unread'"))
})

// ---------- the ways in ----------

test('the rail\'s Home button offers "Mark everything as read" on right-click and on a hold', () => {
  const rail = read('src/components/ServerRail.jsx')
  assert.ok(rail.includes('function HomeRailLink({ active, onMenu })'))
  assert.ok(rail.includes('onContextMenu={(e) => { e.preventDefault(); onMenu(e) }}'), 'right-click')
  assert.ok(rail.includes('const press = useLongPress((pos) => {\n    onMenu('), 'a hold, as the group icons do')
  assert.ok(rail.includes('<HomeRailLink active={onDMs} onMenu={openHomeMenu} />'))
  assert.ok(!rail.includes('<RailLink to="/dms" active={onDMs} label="Direct messages">'), 'the plain link was replaced, not duplicated')
  assert.ok(rail.includes("label: 'Mark everything as read',"))
  assert.ok(rail.includes('onClick: markAll,'))
  assert.ok(rail.includes('disabled: unreadEverywhere === 0,'), 'shown but not clickable when there is nothing to clear')
  assert.ok(rail.includes("trailing: unreadEverywhere === 0 ? 'all caught up' : `${unreadEverywhere} unread`,"))
  assert.ok(rail.includes('open={homeMenu.open}') && rail.includes('items={homeItems}') && rail.includes('onClose={closeHomeMenu}'), 'and the menu is really shown')
})

test('the Home button is still a link to the direct messages, whatever else it does', () => {
  const rail = read('src/components/ServerRail.jsx')
  const home = rail.slice(rail.indexOf('function HomeRailLink'), rail.indexOf('// Mouse + touch long-press'))
  assert.ok(home.includes('<RailLink to="/dms" active={active} label='))
  assert.ok(home.includes('onClick={press.onClick}'), 'only the click that ends a hold is swallowed')
  for (const h of ['onMouseDown', 'onMouseUp', 'onMouseLeave', 'onTouchStart', 'onTouchEnd', 'onTouchMove']) assert.ok(home.includes(`${h}={press.${h}}`), h)
})

test('the hook shares the conversation data the tab title uses, and only the person\'s own groups', () => {
  const hook = read('src/lib/useMarkAllRead.js')
  assert.ok(hook.includes("import { useConversationData } from './useConversationData'"))
  assert.ok(hook.includes('const { convosByOther, channelsByGroup } = useConversationData()'), 'and actually calls it')
  assert.ok(hook.includes('unreadKeys({ dmConvos: Object.values(convosByOther || {}), channelsByGroup, lastRead: lastRead || {} })'))
  assert.ok(hook.includes('await markManyRead(uid, keys)'))
  assert.ok(hook.includes("console.warn('[unread] could not mark everything as read:', e)"), 'a failure is reported, not thrown into a click handler')
})

test('the DM list offers "Mark all read" only when there is a DM to clear', () => {
  const dms = read('src/components/DMsSidebar.jsx')
  assert.ok(dms.includes('() => unreadKeys({ dmConvos: Object.values(convosByOther), lastRead }).dms'), 'built from the unread rule')
  assert.ok(dms.includes('{unreadDmKeys.length > 0 && ('))
  assert.ok(dms.includes('markManyRead(profile.id, unreadDmKeys)'))
  assert.ok(dms.includes('aria-label="Mark all direct messages as read"'))
})

test('right-clicking a DM offers "Mark as read" for that one, and only a DM that exists gets a menu', () => {
  const dms = read('src/components/DMsSidebar.jsx')
  assert.ok(dms.includes('onContextMenu={convo ? (e) => { e.preventDefault(); setMenu({ open: true, x: e.clientX, y: e.clientY, convo }) } : undefined}'))
  assert.ok(dms.includes("label: 'Mark as read',"))
  assert.ok(dms.includes('markManyRead(profile.id, [menuKey])'), 'just this conversation')
  assert.ok(dms.includes('disabled: !menuUnread,'))
  assert.ok(dms.includes("trailing: menuUnread ? undefined : 'already read',"))
  assert.ok(dms.includes('<GroupContextMenu'))
})
