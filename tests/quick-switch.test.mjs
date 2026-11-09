// "Jump to a conversation": what is on the list, and how a typed query ranks it.
//
//   node --test tests/quick-switch.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTargets, normalize, rankTargets } from '../src/lib/quickSwitch.js'
import { pathToReadKey } from '../src/lib/unread.js'

const ts = (n) => ({ toMillis: () => n })
const user = (id, name, email = `${id}@punx.ai`) => ({ id, name, email })
const ids = (list) => list.map(t => t.id)

const users = [user('me', 'Me'), user('ana', 'Ana Reyes'), user('zoe', 'Zoë Park'), user('ben', 'Ben Cruz')]
const groups = [{ id: 'g1', name: 'Punx' }, { id: 'g2', name: 'Design Guild' }]
const channelsByGroup = {
  g1: [{ id: 'c1', name: 'general', lastMessageAt: ts(100) }, { id: 'c2', name: 'marketing', lastMessageAt: ts(300) }, { id: 'v1', name: 'Standup', type: 'voice' }],
  g2: [{ id: 'c3', name: 'general', lastMessageAt: ts(200) }, { id: 'c4', name: 'brand-assets', lastMessageAt: ts(50) }],
}
const build = (over = {}) => buildTargets({ meUid: 'me', users, groups, channelsByGroup, ...over })
const byId = (targets, id) => targets.find(t => t.id === id)

// ---------- what is on the list ----------

test('the list holds notes, every teammate except you, and every channel with its group', () => {
  const t = build()
  assert.deepEqual(ids(t).sort(), ['ch:g1:c1', 'ch:g1:c2', 'ch:g1:v1', 'ch:g2:c3', 'ch:g2:c4', 'dm:ana', 'dm:ben', 'dm:zoe', 'notes'].sort())
  assert.equal(byId(t, 'dm:me'), undefined, 'you are not on your own list')
  assert.equal(byId(t, 'ch:g2:c3').hint, 'Design Guild')
  assert.equal(byId(t, 'ch:g1:v1').kind, 'voice')
  assert.equal(byId(t, 'ch:g1:c1').kind, 'channel')
  assert.equal(byId(t, 'notes').path, '/me/notes')
})

test('each target opens the page the app already uses for it', () => {
  const t = build()
  assert.equal(byId(t, 'dm:ana').path, '/dms/ana')
  assert.equal(byId(t, 'ch:g2:c4').path, '/g/g2/c/c4')
})

test('a person with no name shows their email; a missing one is not a crash', () => {
  const t = build({ users: [{ id: 'x', email: 'x@punx.ai' }, { id: 'y' }, null] })
  assert.equal(byId(t, 'dm:x').label, 'x@punx.ai')
  assert.equal(byId(t, 'dm:y').label, 'Unknown')
})

test('unread: a DM is unread when it has a message from them newer than you read', () => {
  const convos = { ana: { id: 'ana__me', lastMessageAt: ts(500), lastMessageAuthorUid: 'ana' } }
  assert.equal(byId(build({ convosByOther: convos }), 'dm:ana').unread, true)
  assert.equal(byId(build({ convosByOther: convos, lastRead: { [pathToReadKey('dms/ana__me')]: ts(500) } }), 'dm:ana').unread, false)
  const mine = { ana: { id: 'ana__me', lastMessageAt: ts(500), lastMessageAuthorUid: 'me' } }
  assert.equal(byId(build({ convosByOther: mine }), 'dm:ana').unread, false, 'your own last message is not news')
  const opened = { ana: { id: 'ana__me', lastMessageAt: ts(500) } }
  assert.equal(byId(build({ convosByOther: opened }), 'dm:ana').unread, false, 'opened, never written in')
})

test('unread: a channel counts unless its group is muted', () => {
  assert.equal(byId(build(), 'ch:g1:c2').unread, true)
  assert.equal(byId(build({ lastRead: { [pathToReadKey('groups/g1/channels/c2')]: ts(300) } }), 'ch:g1:c2').unread, false)
  assert.equal(byId(build({ mutedGroups: new Set(['g1']) }), 'ch:g1:c2').unread, false)
  assert.equal(byId(build({ mutedGroups: new Set(['g1']) }), 'ch:g2:c3').unread, true, 'only that group')
})

test('nothing loaded yet is an empty list apart from notes, not an error', () => {
  assert.deepEqual(ids(buildTargets({ meUid: 'me' })), ['notes'])
  assert.deepEqual(ids(buildTargets({ meUid: 'me', groups, channelsByGroup: {} })), ['notes'])
})

// ---------- the ranking ----------

const T = (id, label, extra = {}) => ({ id, kind: 'channel', label, hint: '', path: '/' + id, unread: false, at: 0, ...extra })

test('a name that starts with the word beats a word inside it, which beats the middle of a word', () => {
  const targets = [T('mid', 'the-brand-kit'), T('word', 'team brand'), T('start', 'branding'), T('inside', 'rebrand')]
  assert.deepEqual(ids(rankTargets(targets, 'bran')), ['start', 'word', 'mid', 'inside'])
})

test('case and accents do not matter', () => {
  const targets = [user('zoe', 'Zoë Park')].map(u => ({ id: u.id, kind: 'dm', label: u.name, hint: '', path: '/', unread: false, at: 0 }))
  assert.deepEqual(ids(rankTargets(targets, 'ZOE')), ['zoe'])
  assert.deepEqual(ids(rankTargets(targets, 'zoë')), ['zoe'])
  assert.equal(normalize('Ångström'), 'angstrom')
  assert.equal(normalize(null), '')
})

test('every word must match: "ana re" finds Ana Reyes, "ana xyz" finds nothing', () => {
  const t = build()
  assert.deepEqual(ids(rankTargets(t, 'ana re')), ['dm:ana'])
  assert.deepEqual(rankTargets(t, 'ana xyz'), [])
})

test('the group a channel is in can be searched, so the same name in two groups can be told apart', () => {
  const t = build()
  assert.deepEqual(ids(rankTargets(t, 'general design')), ['ch:g2:c3'])
  assert.deepEqual(ids(rankTargets(t, 'general punx')), ['ch:g1:c1'])
})

test('letters in order find a name: "mkt" finds marketing, and a name beats a looser match', () => {
  const t = build()
  assert.deepEqual(ids(rankTargets(t, 'mkt')), ['ch:g1:c2'])
  const targets = [T('loose', 'm k t something'), T('tight', 'market')]
  assert.equal(rankTargets(targets, 'mark')[0].id, 'tight')
})

test('the person\'s email finds them too', () => {
  const t = build()
  assert.deepEqual(ids(rankTargets(t, 'ben@punx')), ['dm:ben'])
})

test('an unread conversation rises above an equally good read one', () => {
  const targets = [T('read', 'design'), T('unread', 'design-review', { unread: true })]
  assert.equal(rankTargets(targets, 'design')[0].id, 'unread')
})

test('but a much better name still beats an unread weaker one', () => {
  const targets = [T('exact', 'ops'), T('weak', 'workshops-and-more', { unread: true })]
  assert.equal(rankTargets(targets, 'ops')[0].id, 'exact')
})

test('nothing typed: unread first, then the most recently active, then A to Z', () => {
  const targets = [
    T('old', 'old', { at: 1 }), T('new', 'new', { at: 9 }), T('unreadOld', 'unread-old', { unread: true, at: 2 }),
    T('unreadNew', 'unread-new', { unread: true, at: 8 }), T('a', 'aaa', { at: 5 }), T('b', 'bbb', { at: 5 }),
  ]
  assert.deepEqual(ids(rankTargets(targets, '')), ['unreadNew', 'unreadOld', 'new', 'a', 'b', 'old'])
  assert.deepEqual(ids(rankTargets(targets, '   ')), ids(rankTargets(targets, '')), 'only spaces is nothing typed')
})

test('"#" means channels only (voice rooms included) and "@" means people only', () => {
  const t = build()
  const hash = rankTargets(t, '#')
  assert.ok(hash.every(x => x.kind === 'channel' || x.kind === 'voice'))
  assert.equal(hash.length, 5)
  assert.deepEqual(ids(rankTargets(t, '#gen')).sort(), ['ch:g1:c1', 'ch:g2:c3'])
  const at = rankTargets(t, '@')
  assert.ok(at.every(x => x.kind === 'dm'))
  assert.deepEqual(ids(rankTargets(t, '@ana')), ['dm:ana'])
  assert.deepEqual(rankTargets(t, '@general'), [], 'a channel name is not a person')
})

test('the list is capped, and ties keep a steady order', () => {
  const many = Array.from({ length: 40 }, (_, i) => T(`c${i}`, `chan-${String(i).padStart(2, '0')}`))
  assert.equal(rankTargets(many, '').length, 12)
  assert.equal(rankTargets(many, 'chan', 5).length, 5)
  assert.deepEqual(ids(rankTargets(many, 'chan', 3)), ['c0', 'c1', 'c2'])
})

test('odd input does not break it', () => {
  const t = build()
  for (const q of ['(', '[', '\\', '.*', '   ', '#@', '@#', '"', '%', '😀', 'a'.repeat(500)]) {
    assert.doesNotThrow(() => rankTargets(t, q), q)
  }
  assert.deepEqual(rankTargets([], 'x'), [])
  assert.deepEqual(rankTargets(t, undefined).length, 9, 'no query at all: everything, up to the cap')
})

test('the same name in different groups stays two entries', () => {
  const t = rankTargets(build(), 'general')
  assert.deepEqual(ids(t).sort(), ['ch:g1:c1', 'ch:g2:c3'])
})

test('starting with the word wins even where the alphabet would put the other first', () => {
  const targets = [T('inword', 'a-brand'), T('starts', 'branding')]
  assert.deepEqual(ids(rankTargets(targets, 'bran')), ['starts', 'inword'])
})
