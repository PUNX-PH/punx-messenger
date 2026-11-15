// "Seen" in direct messages: where the receipt comes from, when it is written (and when it must
// not be), which message the line goes under, how it reads, and that it is switched by a preference.
//
//   node --test tests/seen.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isDmPath, marksNeeded, seenAtOf, seenLabel, seenMarker } from '../src/lib/seen.js'
import { DEFAULT_PREFS, normalizePrefs } from '../src/lib/prefs.js'
import { identityOf } from '../src/lib/usersIdentity.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (f) => lf(fs.readFileSync(f, 'utf8'))
const ts = (ms) => ({ toMillis: () => ms })
const at = (h, m = 0, day = 13) => new Date(2026, 10, day, h, m, 0, 0).getTime() // November 2026, local time
const msg = (id, uid, ms) => ({ id, author: { uid }, createdAt: ms == null ? null : ts(ms) })

// ---------- which paths ----------

test('only a direct message conversation counts, with or without /messages', () => {
  for (const p of ['dms/a__b', 'dms/a__b/messages', 'dms/x']) assert.equal(isDmPath(p), true, p)
  for (const p of ['groups/g/channels/c', 'groups/g/channels/c/messages', 'users/me/notes', 'dms/', 'dms', 'dms/a/b', 'dms/a/messages/m1', 'xdms/a', 'groups/g', 'groups/g/messages', 'users/me', '', undefined, null, 5, {}]) {
    assert.equal(isDmPath(p), false, String(p))
  }
  // Only text: an array or an object that WRITES ITSELF as a DM path is not one.
  assert.equal(isDmPath(['dms/a__b']), false)
  assert.equal(isDmPath({ toString: () => 'dms/a__b' }), false)
})

// ---------- reading the other person's receipt ----------

test('the time they last had it open, from their profile', () => {
  assert.equal(seenAtOf({ seen: { dms__a__b: ts(5000) } }, 'dms__a__b'), 5000)
  assert.equal(seenAtOf({ seen: { dms__a__b: 5000 } }, 'dms__a__b'), 5000, 'a plain number too')
  assert.equal(seenAtOf({ seen: { dms__a__b: ts(5000), dms__a__c: ts(9000) } }, 'dms__a__c'), 9000, 'each conversation has its own')
})

test('nothing, or nonsense, is "never"', () => {
  const bad = [
    undefined, null, {}, { seen: null }, { seen: [] }, { seen: 'x' }, { seen: 5 }, { seen: true }, { seen: {} },
    { seen: { other: ts(5) } },
    { seen: { dms__a__b: null } }, { seen: { dms__a__b: 0 } }, { seen: { dms__a__b: -5 } }, { seen: { dms__a__b: NaN } },
    { seen: { dms__a__b: Infinity } }, { seen: { dms__a__b: 'soon' } }, { seen: { dms__a__b: {} } },
    { seen: { dms__a__b: { toMillis: () => NaN } } }, { seen: { dms__a__b: { toMillis: () => 0 } } },
  ]
  for (const u of bad) assert.equal(seenAtOf(u, 'dms__a__b'), null, JSON.stringify(u))
})

test('names that exist on every object are not receipts', () => {
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(seenAtOf({ seen: {} }, key), null, key)
})

// ---------- what an open conversation writes ----------

const marks = (over) => marksNeeded({
  containerPath: 'dms/a__b', newestCreatedAt: ts(1000), lastRead: ts(500), seen: ts(500), share: true, ...over,
})

test('something new, in a DM, sharing: both are written', () => {
  assert.deepEqual(marks({}), { read: true, seen: true })
})

test('nothing new since last time: nothing is written', () => {
  assert.deepEqual(marks({ lastRead: ts(1000), seen: ts(1000) }), { read: false, seen: false })
  assert.deepEqual(marks({ lastRead: ts(2000), seen: ts(2000) }), { read: false, seen: false })
})

test('the receipt is separate from the unread bookkeeping', () => {
  // "Mark all as read" moved lastRead past everything, but the chat was never opened: opening it still records that.
  assert.deepEqual(marks({ lastRead: ts(1000), seen: ts(500) }), { read: false, seen: true })
  // The other way round: the receipt is up to date, the bookkeeping is not.
  assert.deepEqual(marks({ lastRead: ts(500), seen: ts(1000) }), { read: true, seen: false })
})

test('never a receipt for a channel, a note, or when you do not share', () => {
  assert.deepEqual(marks({ containerPath: 'groups/g/channels/c' }), { read: true, seen: false })
  assert.deepEqual(marks({ containerPath: 'users/me/notes' }), { read: true, seen: false })
  assert.deepEqual(marks({ share: false }), { read: true, seen: false })
  assert.deepEqual(marks({ share: undefined }), { read: true, seen: false })
  assert.deepEqual(marks({ share: 1 }), { read: true, seen: true }, 'any truthy value shares')
})

test('a conversation never read or opened writes both; a newest message still being sent counts as new', () => {
  assert.deepEqual(marks({ lastRead: undefined, seen: undefined }), { read: true, seen: true })
  assert.deepEqual(marks({ newestCreatedAt: null, lastRead: ts(9e12), seen: ts(9e12) }), { read: true, seen: true })
  assert.deepEqual(marks({ newestCreatedAt: undefined }), { read: true, seen: true })
})

// ---------- where the line goes ----------

test('under your latest message that was sent before they last had the chat open', () => {
  const list = [msg('m1', 'me', 100), msg('m2', 'them', 200), msg('m3', 'me', 300)]
  assert.deepEqual(seenMarker(list, 'me', 350), { id: 'm3', at: 350 })
})

test('a newer message of yours they have not seen yet is skipped: the line stays on the last one they did', () => {
  const list = [msg('m1', 'me', 100), msg('m2', 'me', 200), msg('m3', 'me', 500)]
  assert.deepEqual(seenMarker(list, 'me', 250), { id: 'm2', at: 250 })
})

test('at the very moment, it counts; a moment before, it does not', () => {
  const list = [msg('m1', 'me', 100)]
  assert.deepEqual(seenMarker(list, 'me', 100), { id: 'm1', at: 100 })
  assert.equal(seenMarker(list, 'me', 99), null)
})

test('their messages are never marked, and if you have said nothing there is nothing to mark', () => {
  assert.equal(seenMarker([msg('m1', 'them', 100), msg('m2', 'them', 200)], 'me', 900), null)
  assert.equal(seenMarker([], 'me', 900), null)
})

test('a message of yours that is still being sent (no time yet) is not seen, and does not hide an earlier one that was', () => {
  assert.equal(seenMarker([msg('m1', 'me', null)], 'me', 900), null)
  assert.deepEqual(seenMarker([msg('m1', 'me', 100), msg('m2', 'me', null)], 'me', 900), { id: 'm1', at: 900 })
})

test('nothing without a usable receipt, a person, or a list', () => {
  const list = [msg('m1', 'me', 100)]
  for (const seenAt of [null, undefined, 0, -1, NaN, Infinity, '900']) assert.equal(seenMarker(list, 'me', seenAt), null, String(seenAt))
  assert.equal(seenMarker(list, undefined, 900), null)
  assert.equal(seenMarker(list, '', 900), null)
  for (const m of [null, undefined, 'x', {}, 5]) assert.equal(seenMarker(m, 'me', 900), null)
})

test('with nobody signed in yet, a message that has no author is not "yours"', () => {
  assert.equal(seenMarker([{ id: 'z', createdAt: ts(100) }, { id: 'y', author: {}, createdAt: ts(100) }], undefined, 900), null)
  assert.equal(seenMarker([{ id: 'z', createdAt: ts(100) }], null, 900), null)
})

test('odd entries in the list are skipped, not fatal', () => {
  const list = [msg('m1', 'me', 100), null, undefined, {}, { id: 'x', author: null }, { id: 'y', author: { uid: 'me' }, createdAt: {} }]
  assert.deepEqual(seenMarker(list, 'me', 900), { id: 'm1', at: 900 })
})

// ---------- what it says ----------

test('today: just the time, in the person’s clock', () => {
  const now = at(18, 0)
  assert.equal(seenLabel(at(15, 41), now, '12h', 'en-US'), 'Seen 3:41 PM')
  assert.equal(seenLabel(at(15, 41), now, '24h', 'en-US'), 'Seen 15:41')
})

test('another day: the date as well', () => {
  const now = at(9, 0, 13)
  assert.equal(seenLabel(at(15, 41, 12), now, '12h', 'en-US'), 'Seen Nov 12, 3:41 PM')
  assert.equal(seenLabel(new Date(2026, 9, 31, 8, 5).getTime(), now, '24h', 'en-US'), 'Seen Oct 31, 08:05')
  assert.equal(seenLabel(new Date(2025, 10, 13, 8, 5).getTime(), now, '24h', 'en-US').startsWith('Seen Nov 13, '), true, 'a year ago on the same date is not today')
})

test('the same day of ANOTHER month is not today', () => {
  const now = at(9, 0, 13)
  assert.equal(seenLabel(new Date(2026, 9, 13, 8, 5).getTime(), now, '24h', 'en-US'), 'Seen Oct 13, 08:05')
  assert.equal(seenLabel(new Date(2026, 11, 13, 8, 5).getTime(), now, '24h', 'en-US'), 'Seen Dec 13, 08:05')
})

test('just after midnight, a message seen the evening before is yesterday', () => {
  const now = new Date(2026, 10, 13, 0, 1).getTime()
  assert.equal(seenLabel(new Date(2026, 10, 12, 23, 59).getTime(), now, '24h', 'en-US'), 'Seen Nov 12, 23:59')
})

test('no usable time, no line', () => {
  for (const bad of [null, undefined, 0, -3, NaN, Infinity, '5', {}]) assert.equal(seenLabel(bad, at(9)), '', String(bad))
})

// ---------- the choice ----------

test('sharing is on by default, a yes/no, and anything else is the default', () => {
  assert.equal(DEFAULT_PREFS.shareSeen, true)
  assert.equal(normalizePrefs({ shareSeen: false }).shareSeen, false)
  assert.equal(normalizePrefs({ shareSeen: true }).shareSeen, true)
  for (const v of ['no', 0, 1, null, undefined, {}, []]) assert.equal(normalizePrefs({ shareSeen: v }).shareSeen, true, JSON.stringify(v))
})

// ---------- where it lives ----------

test('your receipts stay on your profile: other people’s copy of it does not carry them (a DM reads the one document itself)', () => {
  const user = { id: 'a', name: 'Ana', seen: { dms__a__b: ts(5) } }
  assert.equal('seen' in identityOf(user, false), false)
  assert.deepEqual(Object.keys(identityOf(user, true).seen), ['dms__a__b'], 'your own device needs them')
})

test('only the open conversation writes a receipt; "Mark as read" and "Mark all as read" do not', () => {
  const db = read('src/lib/db.js')
  const fn = db.slice(db.indexOf('export async function markRead'), db.indexOf('export async function clearMySeen'))
  assert.match(fn, /markRead\(uid, containerPath, marks = \{ read: true \}\)/, 'old callers still just mark read')
  assert.match(fn, /if \(marks\.read\) fields\[`lastRead\.\$\{key\}`\] = serverTimestamp\(\)/)
  assert.match(fn, /if \(marks\.seen && isDmPath\(containerPath\)\) fields\[`seen\.\$\{key\}`\] = serverTimestamp\(\)/)
  assert.match(fn, /if \(!Object\.keys\(fields\)\.length\) return/, 'nothing to write, no write')
  const many = db.slice(db.indexOf('export async function markManyRead'), db.indexOf('// Mute or unmute ONE'))
  assert.ok(!many.includes('seen'), 'mark-many never writes a receipt')
  assert.ok(many.includes('lastRead.'))
})

test('a receipt is a server time on your own profile, and switching off removes them all', () => {
  const db = read('src/lib/db.js')
  const clear = db.slice(db.indexOf('export async function clearMySeen'), db.indexOf('export function listenPeerSeen'))
  assert.match(clear, /if \(!uid\) return/)
  assert.match(clear, /updateDoc\(doc\(db, 'users', uid\), \{ seen: deleteField\(\) \}\)/)
  const listen = db.slice(db.indexOf('export function listenPeerSeen'))
  assert.match(listen, /onSnapshot\(doc\(db, 'users', otherUid\), \(snap\) => cb\(seenAtOf\(snap\.data\(\), key\)\), \(\) => cb\(null\)\)/, 'one document; a failure is "not seen"')
})

test('the chat: writes what marksNeeded says, listens to the other person only in a shared DM, and passes the line down', () => {
  const src = read('src/components/ChatSurface.jsx')
  assert.match(src, /const marks = marksNeeded\(\{\s*containerPath, newestCreatedAt: newestCreatedAtRef\.current,\s*lastRead: own\?\.lastRead\?\.\[key\], seen: own\?\.seen\?\.\[key\], share: shareSeen,\s*\}\)/)
  assert.match(src, /if \(!marks\.read && !marks\.seen\) return/)
  assert.match(src, /markRead\(profile\.uid, containerPath, marks\)/)
  assert.match(src, /\[profile\?\.uid, path, newestId, readOnly, looking, loaded, shareSeen\]/, 'turning sharing on or off re-evaluates')
  assert.match(src, /if \(!seenBy \|\| !containerPath \|\| readOnly \|\| !shareSeen \|\| !isDmPath\(containerPath\)\) return\s*return listenPeerSeen\(seenBy, containerPath, setPeerSeenAt\)/)
  assert.match(src, /const seen = shareSeen && seenBy \? seenMarker\(messages, profile\?\.uid, peerSeenAt\) : null/, 'both ways: not shown to you either when you do not share')
  assert.match(src, /seenId=\{seen\?\.id \?\? null\}/)
  assert.match(src, /seenText=\{seen \? seenLabel\(seen\.at, Date\.now\(\), prefs\.timeFormat\) : ''\}/)
  assert.match(src, /setPeerSeenAt\(null\)/, 'a different conversation starts with nothing seen')
  assert.match(src, /if \(!profile\?\.uid \|\| !path \|\| readOnly \|\| !looking \|\| !loaded\) return/, 'still only while looking, loaded, and not an oversight view')
})

test('only a DM is given the other person to watch, and a chat given nobody watches nobody', () => {
  assert.match(read('src/components/ChatSurface.jsx'), /seenBy = null,/)
  assert.match(read('src/views/DMConvo.jsx'), /seenBy=\{other\.id\}/)
  for (const f of ['src/views/ChannelView.jsx', 'src/views/Notes.jsx']) {
    if (fs.existsSync(f)) assert.ok(!read(f).includes('seenBy'), f)
  }
})

test('the list puts the line under that one message, and tells only the group that holds it', () => {
  const src = read('src/components/MessageList.jsx')
  assert.match(src, /seenId=\{b\.items\.some\(m => m\.id === seenId\) \? seenId : null\}/)
  assert.match(src, /seenText=\{seenId === m\.id \? seenText : ''\}/)
  assert.match(src, /\{seenText && \(\s*<div className="mt-0\.5 text-right text-\[11px\] text-ink-dim" data-seen>\{seenText\}<\/div>\s*\)\}/)
})

test('Preferences: a switch, and turning it off removes the receipts already written', () => {
  const src = read('src/components/PreferencesModal.jsx')
  assert.match(src, /label="Let others see when I've read their messages"/)
  assert.match(src, /checked=\{prefs\.shareSeen\}/)
  assert.match(src, /set\(\{ shareSeen: on \}\)\s*if \(!on\) clearMySeen\(profile\?\.id\)\.catch\(\(\) => \{\}\)/)
})
