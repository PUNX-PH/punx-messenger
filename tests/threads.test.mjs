// Threads: a message and the replies to it, built from replies that already exist.
//
//   node --test tests/threads.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  replyTargetOf, replyCounts, sameCounts, sortByTime, threadReplies, replyLabel, threadsAllowed, currentRoot,
} from '../src/lib/threads.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const ts = (ms) => ({ toMillis: () => ms })
const msg = (id, replyTo = null, ms = null) => ({ id, text: 't' + id, replyTo: replyTo ? { messageId: replyTo } : null, createdAt: ms === null ? null : ts(ms) })

// ---------- which message a reply belongs to ----------

test('a reply belongs to the message it quotes', () => {
  assert.equal(replyTargetOf(msg('b', 'a')), 'a')
})

test('not a reply, or a malformed one, belongs to nothing', () => {
  assert.equal(replyTargetOf(msg('b')), null)
  assert.equal(replyTargetOf(null), null)
  assert.equal(replyTargetOf(undefined), null)
  assert.equal(replyTargetOf({ id: 'b' }), null)
  assert.equal(replyTargetOf({ id: 'b', replyTo: null }), null)
  assert.equal(replyTargetOf({ id: 'b', replyTo: {} }), null)
  for (const bad of [5, true, {}, [], '', null, undefined]) {
    assert.equal(replyTargetOf({ id: 'b', replyTo: { messageId: bad } }), null, String(bad))
  }
})

test('a message that quotes itself is not in its own thread', () => {
  assert.equal(replyTargetOf(msg('a', 'a')), null)
})

// ---------- counts ----------

test('how many direct replies each message has', () => {
  const list = [msg('a'), msg('b', 'a'), msg('c', 'a'), msg('d', 'b'), msg('e')]
  const counts = replyCounts(list)
  assert.equal(counts.get('a'), 2)
  assert.equal(counts.get('b'), 1, 'a reply can have a thread of its own')
  assert.equal(counts.get('e'), undefined)
  assert.equal(counts.size, 2)
})

test('a reply to a reply is not counted for the first message: a thread is flat', () => {
  const counts = replyCounts([msg('a'), msg('b', 'a'), msg('c', 'b')])
  assert.equal(counts.get('a'), 1)
  assert.equal(counts.get('b'), 1)
})

test('no messages, or none that reply, is an empty count', () => {
  assert.equal(replyCounts([]).size, 0)
  assert.equal(replyCounts(null).size, 0)
  assert.equal(replyCounts([msg('a'), msg('b')]).size, 0)
  assert.equal(replyCounts([msg('a', 'a')]).size, 0)
})

test('a reply whose original is not loaded still counts for it (the count is by id, not by presence)', () => {
  assert.equal(replyCounts([msg('b', 'gone')]).get('gone'), 1)
})

test('two counts are the same when they say the same thing', () => {
  const m = (pairs) => new Map(pairs)
  assert.equal(sameCounts(m([['a', 1]]), m([['a', 1]])), true)
  assert.equal(sameCounts(m([]), m([])), true)
  assert.equal(sameCounts(m([['a', 1]]), m([['a', 2]])), false, 'another number')
  assert.equal(sameCounts(m([['a', 1]]), m([['b', 1]])), false, 'another message')
  assert.equal(sameCounts(m([['a', 1]]), m([['a', 1], ['b', 1]])), false, 'one more')
  assert.equal(sameCounts(m([['a', 1], ['b', 1]]), m([['a', 1]])), false, 'one fewer')
  const same = m([['a', 1]])
  assert.equal(sameCounts(same, same), true)
  assert.equal(sameCounts(null, m([])), false)
  assert.equal(sameCounts(m([]), undefined), false)
})

// ---------- the thread itself ----------

test('the replies to one message, oldest first', () => {
  const list = [msg('a', null, 10), msg('r2', 'a', 300), msg('x', 'other', 200), msg('r1', 'a', 100), msg('plain', null, 150)]
  assert.deepEqual(threadReplies(list, 'a').map(m => m.id), ['r1', 'r2'])
})

test('the root is never one of its own replies (even if it quotes itself), and a message still being sent comes last', () => {
  const list = [msg('a', 'a', 10), msg('late', 'a', null), msg('r1', 'a', 100)]
  assert.deepEqual(threadReplies(list, 'a').map(m => m.id), ['r1', 'late'])
  assert.ok(!threadReplies(list, 'a').some(m => m.id === 'a'))
})

test('the same time falls back to the id, so the order never flickers', () => {
  const list = [msg('b', 'a', 100), msg('c', 'a', 100), msg('a2', 'a', 100)]
  assert.deepEqual(threadReplies(list, 'a').map(m => m.id), ['a2', 'b', 'c'])
  assert.deepEqual(threadReplies([...list].reverse(), 'a').map(m => m.id), ['a2', 'b', 'c'])
})

test('two messages both still being sent keep a stable order too', () => {
  assert.deepEqual(sortByTime([msg('z', 'a', null), msg('y', 'a', null)]).map(m => m.id), ['y', 'z'])
})

test('times may be plain numbers, as well as server times', () => {
  const list = [{ id: 'a', createdAt: 200 }, { id: 'z', createdAt: 100 }]
  assert.deepEqual(sortByTime(list).map(m => m.id), ['z', 'a'], 'by time, not by id')
})

test('a time that is not a number counts as not sent yet', () => {
  assert.deepEqual(sortByTime([{ id: 'a', createdAt: Number.NaN }, { id: 'b', createdAt: 100 }]).map(m => m.id), ['b', 'a'])
  assert.deepEqual(sortByTime([{ id: 'a', createdAt: undefined }, { id: 'b', createdAt: 100 }]).map(m => m.id), ['b', 'a'])
  assert.deepEqual(sortByTime([{ id: 'a', createdAt: 'soon' }, { id: 'b', createdAt: 100 }]).map(m => m.id), ['b', 'a'])
})

test('whatever order they arrive in, the order is the same: by time, not-yet-sent last', () => {
  const items = [msg('d', 'r', 300), msg('b', 'r', 100), msg('a', 'r', null), msg('c', 'r', 200)] // the unsent one has the id that would sort first
  const perms = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map(r => [x, ...r]))
  for (const order of perms(items)) assert.deepEqual(sortByTime(order).map(m => m.id), ['b', 'c', 'd', 'a'])
})

test('times run oldest to newest even where the ids say otherwise', () => {
  assert.deepEqual(sortByTime([msg('a', 'r', 900), msg('b', 'r', 100)]).map(m => m.id), ['b', 'a'])
})

test('sorting leaves the list it was given alone', () => {
  const list = [msg('b', 'a', 2), msg('c', 'a', 1)]
  const copy = [...list]
  sortByTime(list)
  assert.deepEqual(list, copy)
})

test('nothing to look in, or no root, is no thread', () => {
  assert.deepEqual(threadReplies(null, 'a'), [])
  const mixed = [msg('r', 'a', 1), msg('plain', null, 2), msg('plain2', null, 3)]
  assert.deepEqual(threadReplies(mixed, ''), [])
  assert.deepEqual(threadReplies(mixed, null), [], 'no root is not "every message that is not a reply"')
  assert.deepEqual(threadReplies(mixed, undefined), [])
  assert.deepEqual(threadReplies(mixed, 7), [])
  assert.deepEqual(threadReplies([null, undefined, msg('r', 'a', 1)], 'a').map(m => m.id), ['r'])
})

test('the words for a count', () => {
  assert.equal(replyLabel(1), '1 reply')
  assert.equal(replyLabel(2), '2 replies')
  assert.equal(replyLabel(0), '0 replies')
  assert.equal(replyLabel(120), '120 replies')
})

test('threads are for conversations, not for My Notes', () => {
  assert.equal(threadsAllowed('dms/a__b/messages'), true)
  assert.equal(threadsAllowed('groups/g/channels/c/messages'), true)
  assert.equal(threadsAllowed('users/me/notes'), false)
  assert.equal(threadsAllowed(''), false)
  assert.equal(threadsAllowed(null), false)
  assert.equal(threadsAllowed(undefined), false)
  assert.equal(threadsAllowed('xdms/a'), false)
})

test('the open message is shown as it is now, or as it was when the thread was opened', () => {
  const opened = { id: 'a', text: 'old' }
  const now = { id: 'a', text: 'edited' }
  assert.equal(currentRoot([msg('x'), now], opened), now, 'edited since: the new text')
  assert.equal(currentRoot([msg('x')], opened), opened, 'scrolled out of the loaded part: the copy')
  assert.equal(currentRoot([], opened), opened)
  assert.equal(currentRoot(null, opened), opened)
  assert.equal(currentRoot([now], null), null)
  assert.equal(currentRoot([now], undefined), null)
})

// ---------- wired together ----------

test('the replies are their own query: every reply to this message, not a filter on what is loaded', () => {
  const d = read('src/lib/db.js')
  assert.ok(d.includes("export function listenReplies(path, rootId, cb, onError) {"))
  assert.ok(d.includes("where('replyTo.messageId', '==', rootId), fbLimit(THREAD_LIMIT)"))
  assert.ok(d.includes('export const THREAD_LIMIT = 200\n'))
  assert.ok(d.includes('}, onError)\n}\n\n// Mark a channel or DM convo as read'), 'errors are passed on')
  // No ordering in the query: that would need an index of its own, which is a deploy.
  const body = d.slice(d.indexOf('export function listenReplies'), d.indexOf('// Mark a channel or DM convo as read'))
  assert.ok(!body.includes('orderBy('))
  assert.ok(body.includes('cleanMessage(d.data())'), 'a message with a malformed text is cleaned like any other')
})

test('the list counts replies once, and hands the same map on while nothing changed', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes("import { replyCounts as countReplies, replyLabel, sameCounts } from '../lib/threads'"))
  assert.ok(l.includes('const next = countReplies(messages)'))
  assert.ok(l.includes('if (sameCounts(countsRef.current, next)) return countsRef.current'))
  assert.ok(l.includes('countsRef.current = next'))
  assert.ok(l.includes('}, [messages])'))
  assert.ok(l.includes('onOpenThread = null,'))
  // Down to the row, as a number: the row is memoised and a map would redraw every one.
  assert.ok(l.includes('replyCounts={replyCounts}'))
  assert.ok(l.includes('replyCount={replyCounts?.get(m.id) || 0}'))
  assert.equal(l.split('onOpenThread={onOpenThread}').length - 1, 2, 'list -> group -> row')
})

test('a message with replies shows how many, and opens the thread; any message can start one', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('{replyCount > 0 && onOpenThread && ('))
  assert.ok(l.includes('onClick={() => onOpenThread(message)}'))
  assert.equal(l.split('onClick={() => onOpenThread(message)}').length - 1, 2, 'the count and the toolbar button')
  assert.ok(l.includes('{replyLabel(replyCount)}'))
  assert.ok(l.includes("title={replyCount > 0 ? 'Open thread' : 'Start a thread'}"))
  assert.ok(l.includes('{onOpenThread && (\n            <button'))
  assert.ok(l.includes('onReact || onReply || onOpenThread || canCopy'), 'a message with only this to offer still gets the toolbar')
})

test('the conversation opens a thread beside it, only in conversations, and drops it when you move', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('onOpenThread={threadsAllowed(path) ? setOpenThread : null}'))
  assert.ok(s.includes('useEffect(() => { setOpenThread(null) }, [path])'))
  assert.ok(s.includes('{openThread && threadsAllowed(path) && ('))
  assert.ok(s.includes('root={currentRoot(messages, openThread)}'))
  assert.ok(s.includes("import { ForwardDialog, ThreadPanel } from '../lib/lazyParts'"), 'loaded on demand')
  assert.ok(s.includes('<LazySlot\n        overlay\n        title="The thread couldn\'t be opened"'))
  assert.ok(s.includes('onClose={() => setOpenThread(null)}'))
  assert.ok(s.includes('readOnly={readOnly}\n          onSend={threadSend}'), 'the panel is told, and sends through its own function')
  // The conversation is still the drop zone for pictures, and sits beside the panel, not inside it.
  assert.ok(s.includes('<div className="relative flex-1 flex min-w-0">\n    <main ref={surfaceRef}'))
})

test('a reply written in a thread quotes the message, as any reply does, and leaves the conversation\'s own reply alone', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('const threadSend = async ({ text, imageFile, imageURL, imageMeta, audio, replyTo }) => {'))
  assert.ok(s.includes('await sendMessage(path, { text, imageFile, imageURL, imageMeta, audio, author: profile, replyTo })'))
  const body = s.slice(s.indexOf('const threadSend'), s.indexOf('const onTyping'))
  assert.ok(!body.includes('setReplyingTo'), 'sending in a thread does not clear a reply being written in the conversation')
  assert.ok(!body.includes('setTyping'))
  const p = read('src/components/ThreadPanel.jsx')
  assert.ok(p.includes('const sendReply = (m) => onSend({ ...m, replyTo: root })'))
  assert.ok(p.includes('onSend={sendReply}'))
})

test('the panel: its own listener, replaced with the thread, torn down with it; reading only when read-only', () => {
  const p = read('src/components/ThreadPanel.jsx')
  assert.ok(p.includes('return listenReplies('))
  assert.ok(p.includes('}, [path, root.id])'))
  assert.ok(p.includes('}, [replies.length, root.id])'), 'the panel follows new replies down')
  assert.ok(p.includes('const loaded = state.rootId === root.id'), 'another thread\'s replies are never shown under this one')
  assert.ok(p.includes('threadReplies(state.replies, root.id)'))
  assert.ok(p.includes('{!readOnly && (\n        <Composer'))
  assert.ok(p.includes('draftId={`${path}#thread:${root.id}`}'), 'what is typed in a thread is kept per thread')
  assert.ok(p.includes("if (e.key === 'Escape' && !e.defaultPrevented) onClose()"))
  assert.ok(p.includes('md:w-[360px]'))
  assert.ok(p.includes('dropZoneRef={asideRef}'), 'pictures can be dropped on the panel')
  assert.ok(p.includes("describeListenError(err)"), 'a failing listener is said, not silent')
})

test('threads are lazy parts, listed with the others', () => {
  const l = read('src/lib/lazyParts.js')
  assert.ok(l.includes("export const ThreadPanel = lazyWithPreload(() => import('../components/ThreadPanel'))"))
})
