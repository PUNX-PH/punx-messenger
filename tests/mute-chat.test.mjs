// Muting ONE conversation (a DM or a single channel): what it silences, what it does not,
// and that each place that shows or counts unread agrees.
//
//   node --test tests/mute-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mutedChatsOf, muteLabel } from '../src/lib/muted.js'
import { countUnread, pathToReadKey, unreadKeys } from '../src/lib/unread.js'
import { buildTargets, pickUnread } from '../src/lib/quickSwitch.js'
import { identityOf, shareIdentity } from '../src/lib/usersIdentity.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (f) => lf(fs.readFileSync(f, 'utf8'))
const ts = (ms) => ({ toMillis: () => ms })
const dm = (id, at, author = 'ana') => ({ id, lastMessageAt: ts(at), lastMessageAuthorUid: author })
const ch = (id, at) => ({ id, name: id, lastMessageAt: ts(at) })
const key = (p) => pathToReadKey(p)

// ---------- the data ----------

test('the muted conversations of a profile are a set of keys, and anything else is none', () => {
  assert.deepEqual([...mutedChatsOf({ mutedChats: ['dms__a', 'groups__g__channels__c'] })].sort(), ['dms__a', 'groups__g__channels__c'])
  for (const bad of [undefined, null, {}, { mutedChats: null }, { mutedChats: 'dms__a' }, { mutedChats: { dms__a: true } }, { mutedChats: 5 }]) {
    assert.equal(mutedChatsOf(bad).size, 0, JSON.stringify(bad))
  }
  assert.deepEqual([...mutedChatsOf({ mutedChats: ['a', '', 7, null, 'a', 'b'] })].sort(), ['a', 'b'], 'blank and non-text entries dropped, repeats merged')
})

test('the menu wording', () => {
  assert.equal(muteLabel(false, 'channel'), 'Mute channel')
  assert.equal(muteLabel(true, 'channel'), 'Unmute channel')
  assert.equal(muteLabel(false, 'conversation'), 'Mute conversation')
  assert.equal(muteLabel(true, 'conversation'), 'Unmute conversation')
})

// ---------- the badge ----------

const base = () => ({
  dmConvos: [dm('d1', 200), dm('d2', 200)],
  channelsByGroup: { g: [ch('c1', 200), ch('c2', 200)] },
  lastRead: {}, meUid: 'me',
})

test('a muted DM and a muted channel do not count; the others still do', () => {
  assert.equal(countUnread(base()), 4)
  assert.equal(countUnread({ ...base(), mutedChats: new Set([key('dms/d1')]) }), 3)
  assert.equal(countUnread({ ...base(), mutedChats: new Set([key('groups/g/channels/c2')]) }), 3)
  assert.equal(countUnread({ ...base(), mutedChats: new Set([key('dms/d1'), key('dms/d2'), key('groups/g/channels/c1'), key('groups/g/channels/c2')]) }), 0)
})

test('muting one thing never silences a neighbour with a similar name', () => {
  const input = { ...base(), dmConvos: [dm('d1', 200), dm('d10', 200)], mutedChats: new Set([key('dms/d1')]) }
  assert.equal(countUnread(input), 3, 'd10 still counts')
})

test('with no mute list nothing changes, and a group mute still works beside it', () => {
  assert.equal(countUnread({ ...base(), mutedChats: undefined }), 4)
  assert.equal(countUnread({ ...base(), mutedGroups: new Set(['g']), mutedChats: new Set([key('dms/d1')]) }), 1, 'channels muted by their group, one DM by itself')
})

test('mute only quietens: "mark as read" still finds a muted conversation and clears it', () => {
  const input = { ...base(), mutedChats: new Set([key('dms/d1'), key('groups/g/channels/c1')]) }
  const { dms, channels } = unreadKeys(input)
  assert.ok(dms.includes('dms__d1'))
  assert.ok(channels.includes('groups__g__channels__c1'))
})

// ---------- the quick switcher and the unread hotkeys ----------

const targetsFor = (over = {}) => buildTargets({
  meUid: 'me',
  users: [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Ben' }],
  convosByOther: { u1: dm('d1', 200, 'u1'), u2: dm('d2', 300, 'u2') },
  groups: [{ id: 'g', name: 'Team' }],
  channelsByGroup: { g: [ch('c1', 400), ch('c2', 500)] },
  lastRead: {},
  ...over,
})
const unreadIds = (targets) => targets.filter((t) => t.unread).map((t) => t.id).sort()

test('a muted conversation is not unread to the switcher, so "next unread" skips it', () => {
  assert.deepEqual(unreadIds(targetsFor()), ['ch:g:c1', 'ch:g:c2', 'dm:u1', 'dm:u2'])
  const muted = targetsFor({ mutedChats: new Set([key('dms/d1'), key('groups/g/channels/c2')]) })
  assert.deepEqual(unreadIds(muted), ['ch:g:c1', 'dm:u2'])
  assert.equal(pickUnread(muted, '/', 'down').id, 'dm:u2', 'the one waiting longest, among those that are not muted')
  assert.equal(pickUnread(muted, '/', 'up').id, 'ch:g:c1')
})

test('a muted conversation can still be found and opened from the switcher', () => {
  const muted = targetsFor({ mutedChats: new Set([key('dms/d1')]) })
  assert.ok(muted.some((t) => t.id === 'dm:u1' && t.path === '/dms/u1'))
})

// ---------- who sees whose mute list ----------

test('my own mute list stays live for me and is dropped from everyone else\'s view of a person', () => {
  const user = { id: 'ana', name: 'Ana', mutedChats: ['dms__x'], lastRead: { a: ts(1) }, presence: 'online', lastSeen: ts(5) }
  assert.deepEqual(identityOf(user, true).mutedChats, ['dms__x'])
  assert.equal('mutedChats' in identityOf(user, false), false)
  assert.equal('presence' in identityOf(user, true), false, 'presence is still left out, as before')
})

test('changing my mute list gives a new object; changing someone else\'s gives the same one (no redraw)', () => {
  const run = (prev, list) => shareIdentity(prev, list, 'me')
  const me = (mutedChats) => ({ id: 'me', name: 'Me', mutedChats })
  const ben = (mutedChats) => ({ id: 'ben', name: 'Ben', mutedChats })
  const first = run(new Map(), [me(['a']), ben(['a'])])
  const second = run(first.next, [me(['a', 'b']), ben(['a', 'b', 'c'])])
  assert.notEqual(second.users[0], first.users[0], 'my badges must update')
  assert.equal(second.users[1], first.users[1], 'nobody else\'s screen needs to redraw for it')
})

// ---------- the write, and the rules that allow it ----------

test('the write adds or removes one key on the person\'s own profile, by union and removal', () => {
  const db = read('src/lib/db.js')
  const fn = db.slice(db.indexOf('export async function toggleMuteChat'), db.indexOf('// Listen to all DM convos'))
  assert.ok(fn.includes('if (!uid || !key) return'))
  assert.ok(fn.includes("await updateDoc(doc(db, 'users', uid), { mutedChats: mute ? arrayUnion(key) : arrayRemove(key) })"))
  assert.ok(!/setDoc|deleteDoc|lastRead/.test(fn), 'nothing else is touched')
  assert.match(db.split('\n').slice(0, 6).join('\n'), /arrayRemove, arrayUnion/)
})

test('the rules already let a person change this on their own profile: it is not one of the protected fields', () => {
  const rules = read('firestore.rules')
  const users = rules.slice(rules.indexOf('match /users/{uid} {'), rules.indexOf('// Private notes: only the owner'))
  const protectedList = /affectedKeys\(\)\s*\.hasAny\(\[([^\]]*)\]\)/.exec(users)
  assert.ok(protectedList, 'the list of fields a person may not change was found')
  const names = protectedList[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  assert.ok(names.includes('role') && names.includes('email'), 'it is the right list')
  assert.ok(!names.includes('mutedChats'), 'so muting needs no rules change')
  assert.ok(!rules.includes('mutedChats'), 'and none was made')
})

// ---------- the places it is wired ----------

test('the tab title, the quick switcher and the unread hotkeys all use the mute list', () => {
  const hook = read('src/lib/useUnreadCount.js')
  assert.ok(hook.includes('mutedChats: mutedChatsOf({ mutedChats: mutedChatList }),'))
  assert.ok(hook.includes('mutedList, mutedChatList, meUid, active, pathname])'), 'and recounts when it changes')
  for (const f of ['src/components/QuickSwitcher.jsx', 'src/components/UnreadHotkeys.jsx']) {
    const src = read(f)
    assert.ok(src.includes('mutedChats: mutedChatsOf(me),'), f)
    assert.ok(src.includes('me?.mutedGroups, me?.mutedChats])'), f + ' recomputes when it changes')
    assert.ok(src.includes("import { mutedChatsOf } from '../lib/muted'"), f)
  }
})

test('a muted channel does not light up its group on the rail', () => {
  const rail = read('src/components/ServerRail.jsx')
  assert.ok(rail.includes('const mutedChats = useMemo(() => mutedChatsOf(me), [me?.mutedChats])'))
  assert.ok(rail.includes('return !mutedChats.has(key) && isUnread(c.lastMessageAt, lastRead[key])'))
})

test('a DM can be muted from its menu, and a muted DM is dimmed, with no dot and no bold', () => {
  const dms = read('src/components/DMsSidebar.jsx')
  assert.ok(dms.includes("label: muteLabel(menuMuted, 'conversation'),"))
  assert.ok(dms.includes('onClick: () => toggleMuteChat(profile.id, menuKey, !menuMuted)'))
  assert.ok(dms.includes('const unread = !muted && !isActive && convo'))
  assert.ok(dms.includes("muted && !isActive ? 'opacity-60 hover:opacity-100' : '',"))
  assert.ok(dms.includes('title={muted ? `${u.name} (muted)` : undefined}'))
  assert.ok(dms.includes('.dms.filter(k => !mutedChats.has(k)),'), '"Mark all read" is not offered for conversations that show no dot')
  assert.ok(dms.includes('[convosByOther, lastRead, mutedChats],'))
})

test('anyone can mute a text channel from its menu; only managers get the admin items; voice channels are managers only', () => {
  const side = read('src/components/ChannelSidebar.jsx')
  assert.ok(side.includes("const muteItems = chMenu.channel && chMenu.channel.type !== 'voice' ? [{"), 'mute: text channels only')
  assert.ok(side.includes("label: muteLabel(chMuted, 'channel'),"))
  assert.ok(side.includes('const adminItems = chMenu.channel && canManage ? ['), 'admin items: managers only')
  assert.ok(side.includes('onContextMenu={canManage || c.type !== \'voice\' ? (e) => onChannelContextMenu(e, c) : undefined}'), 'a voice channel has no menu for non-managers')
  assert.ok(side.includes('muteItems.length && adminItems.length ? [{ separator: true }] : []'), 'a separator only when both kinds are there')
  assert.ok(side.includes('items={channelMenuItems}'))
  assert.ok(side.includes('toggleMuteChat(profile.id, chKey, !chMuted)'))
})

test('a muted channel is dimmed, with no dot and no bold, and both lists of channels know about the mute list', () => {
  const side = read('src/components/ChannelSidebar.jsx')
  assert.ok(side.includes('unread={!muted && c.id !== activeChannelId && isUnread(c.lastMessageAt, lastRead[key])}'))
  assert.ok(side.includes("muted && !active ? 'opacity-60 hover:opacity-100' : '',"))
  assert.equal((side.match(/mutedChats=\{mutedChats\}/g) || []).length, 2, 'uncategorised and categorised channels')
  assert.ok(side.includes('title={muted ? `${channel.name} (muted)` : undefined}'))
})

test('a muted DM does not ping or notify, and a channel @mention still does', () => {
  const n = read('src/lib/notifications.jsx')
  assert.ok(n.includes('if (mutedChatsOf(byIdRef.current[profile.id]).has(pathToReadKey(`dms/${dm.id}`))) return'))
  // The check sits before the notification is fired, in the DM listener only.
  const dmPart = n.slice(n.indexOf('// ── DMs → notify'), n.indexOf('// ── Channel @mentions'))
  assert.ok(dmPart.indexOf('mutedChatsOf(') > 0 && dmPart.indexOf('mutedChatsOf(') < dmPart.indexOf('fire({'))
  const mentionPart = n.slice(n.indexOf('// ── Channel @mentions'))
  assert.ok(!mentionPart.includes('mutedChatsOf('), 'a mention is never silenced by muting the channel')
})
