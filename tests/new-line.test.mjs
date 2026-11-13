// The "New" line: where it goes when you open a conversation with unread messages.
//
//   node --test tests/new-line.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { firstUnreadId } from '../src/lib/unread.js'
import { buildBlocks } from '../src/lib/messageBlocks.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) })
const T0 = Date.UTC(2026, 10, 10, 9, 0)
const msg = (id, minutes, uid = 'ana') => ({ id, author: { uid }, createdAt: ts(T0 + minutes * 60000), text: id })

// ---------- where the line goes ----------

test('it goes above the first message newer than your last-read time', () => {
  const list = [msg('a', 0), msg('b', 1), msg('c', 2), msg('d', 3)]
  assert.equal(firstUnreadId(list, ts(T0 + 60000), 'me'), 'c')
  assert.equal(firstUnreadId(list, ts(T0 + 2 * 60000 - 1), 'me'), 'c', 'one millisecond before c')
  assert.equal(firstUnreadId(list, ts(T0 + 2 * 60000), 'me'), 'd', 'a message AT the read time is read')
})

test('nothing unread, or no last-read time at all, means no line', () => {
  const list = [msg('a', 0), msg('b', 1)]
  assert.equal(firstUnreadId(list, ts(T0 + 5 * 60000), 'me'), null, 'all read')
  assert.equal(firstUnreadId(list, undefined, 'me'), null, 'never opened: not "all new"')
  assert.equal(firstUnreadId(list, null, 'me'), null)
  assert.equal(firstUnreadId(list, ts(0), 'me'), null, 'a zero read time is the same as none')
  assert.equal(firstUnreadId([], ts(T0), 'me'), null)
  assert.equal(firstUnreadId(undefined, ts(T0), 'me'), null)
})

test('your own messages are never new to you, so the line skips them', () => {
  const list = [msg('a', 0), msg('mine', 2, 'me'), msg('b', 3)]
  assert.equal(firstUnreadId(list, ts(T0 + 60000), 'me'), 'b')
  assert.equal(firstUnreadId([msg('a', 0), msg('mine', 2, 'me')], ts(T0 + 60000), 'me'), null)
})

test('when the first loaded message is already unread there is no honest place for a line', () => {
  const list = [msg('a', 5), msg('b', 6)]
  assert.equal(firstUnreadId(list, ts(T0), 'me'), null, 'older messages may be unread too')
})

test('a message still waiting for its server time is skipped, not treated as new or as old', () => {
  const pending = { id: 'p', author: { uid: 'ana' }, createdAt: null }
  assert.equal(firstUnreadId([msg('a', 0), pending, msg('b', 3)], ts(T0 + 60000), 'me'), 'b')
  assert.equal(firstUnreadId([msg('a', 0), msg('b', 1), pending], ts(T0 + 5 * 60000), 'me'), null)
})

// ---------- the line in the layout ----------

const shape = (blocks) => blocks.map(b => b.type === 'group' ? b.items.map(m => m.id).join('+') : b.type)

test('the marker sits just above that message and starts a new group, even for the same person', () => {
  const list = [msg('a', 0), msg('b', 1), msg('c', 2), msg('d', 3)]
  assert.deepEqual(shape(buildBlocks(list, 5)), ['day', 'a+b+c+d'], 'without it, one run')
  assert.deepEqual(shape(buildBlocks(list, 5, 'c')), ['day', 'a+b', 'new', 'c+d'])
})

test('on a new day the day heading comes first and the marker after it', () => {
  const next = { id: 'n', author: { uid: 'ana' }, createdAt: ts(T0 + 26 * 3600000) }
  assert.deepEqual(shape(buildBlocks([msg('a', 0), next], 5, 'n')), ['day', 'a', 'day', 'new', 'n'])
})

test('no id, or an id that is not in the list, adds nothing; existing layouts are unchanged', () => {
  const list = [msg('a', 0), msg('b', 1)]
  assert.deepEqual(shape(buildBlocks(list, 5, null)), shape(buildBlocks(list, 5)))
  assert.deepEqual(shape(buildBlocks(list, 5, 'gone')), shape(buildBlocks(list, 5)))
})

test('the marker has its own stable key', () => {
  const b = buildBlocks([msg('a', 0), msg('b', 1)], 5, 'b').find(x => x.type === 'new')
  assert.equal(b.key, 'new-b')
})

// ---------- the wiring ----------

test('the chat view decides the line once per opening, from the first batch, and clears it on leaving', () => {
  const src = lf(fs.readFileSync('src/components/ChatSurface.jsx', 'utf8'))
  assert.ok(src.includes('newFromDecidedFor.current !== path'), 'only the first batch for this opening decides')
  assert.ok(src.includes('newFromDecidedFor.current = path'))
  assert.ok(src.includes('firstUnreadId(docs, lastRead, profile.uid)'), 'from the batch itself and your read time')
  assert.ok(/newFromDecidedFor\.current = null\n\s*setNewFrom\(null\)/.test(src), 'cleared when the conversation changes')
  assert.ok(src.includes("docs.length && !readOnly && !path.startsWith('users/')) {"), 'not where reading is not tracked')
  assert.ok(src.includes('newFromId={newFrom?.path === path ? newFrom.id : null}'), 'a line from another conversation is never shown')
  assert.ok(!/useEffect\([^]*firstUnreadId[^]*\[[^\]]*usersById/.test(src), 'it does not re-run when your read time moves')
})

test('the read time used is the one from the moment of opening, not from when the messages arrive', () => {
  const src = lf(fs.readFileSync('src/components/ChatSurface.jsx', 'utf8'))
  // Marking a chat read happens 400 ms after opening whether or not its messages have
  // loaded, so a time read later may already be "just now" and the line would be lost.
  const capture = src.indexOf("readAtEntry.current = meNow && path && !path.startsWith('users/')")
  const markRead = src.indexOf('markRead(profile.uid, containerPath)')
  assert.ok(capture > 0, 'captured when the conversation changes')
  assert.ok(markRead > capture, 'before the mark-read effect can run')
  assert.ok(src.includes('{ known: true, at: meNow.lastRead?.[pathToReadKey('), 'it is your read time for this conversation')
  assert.ok(src.includes('const lastRead = entry?.known ? entry.at : me.lastRead?.'), 'the captured time wins over the current one')
  assert.ok(src.includes('(entry?.known || me)'), 'it still works when the directory had not arrived at opening')
})

test('the list draws a separator for it and passes the id to the layout', () => {
  const src = lf(fs.readFileSync('src/components/MessageList.jsx', 'utf8'))
  assert.ok(src.includes('buildBlocks(messages, groupMinutes, newFromId)'))
  assert.ok(src.includes("b.type === 'new' ?"))
  assert.ok(src.includes('aria-label="New messages"'))
})
