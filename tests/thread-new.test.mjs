// What is new in a thread: replies from others since you last read the conversation and last had the thread open.
//
//   node --test tests/thread-new.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { newReplyCounts, markThreadSeen, newRepliesLabel, sameCounts } from '../src/lib/threads.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const ts = (ms) => ({ toMillis: () => ms })
// A message `id` replying to `to` (null: not a reply), by `uid`, sent at `ms` (null: still being sent).
const msg = (id, to, ms, uid = 'other') => ({ id, text: 't' + id, author: { uid }, replyTo: to ? { messageId: to } : null, createdAt: ms === null ? null : ts(ms) })
const obj = (m) => Object.fromEntries(m)

// ---------- which replies are new ----------

test('a reply from someone else, after the conversation was last read, is new for its message', () => {
  const list = [msg('a', null, 50), msg('r', 'a', 200)]
  assert.deepEqual(obj(newReplyCounts(list, 'me', 100)), { a: 1 })
})

test('counted per message, only those with any', () => {
  const list = [msg('a', null, 10), msg('b', null, 20), msg('r1', 'a', 200), msg('r2', 'a', 210), msg('r3', 'b', 220), msg('old', 'b', 50)]
  assert.deepEqual(obj(newReplyCounts(list, 'me', 100)), { a: 2, b: 1 })
  assert.equal(newReplyCounts(list, 'me', 100).has('c'), false)
})

test('a reply sent before the conversation was last read is not new, and neither is one at that very moment', () => {
  assert.equal(newReplyCounts([msg('r', 'a', 99)], 'me', 100).size, 0)
  assert.equal(newReplyCounts([msg('r', 'a', 100)], 'me', 100).size, 0, 'strictly after')
  assert.equal(newReplyCounts([msg('r', 'a', 101)], 'me', 100).size, 1)
})

test('your own replies are never new to you, and someone else\'s are', () => {
  const list = [msg('mine', 'a', 200, 'me'), msg('theirs', 'a', 210, 'ana')]
  assert.deepEqual(obj(newReplyCounts(list, 'me', 100)), { a: 1 })
})

test('a reply with no author is someone else\'s', () => {
  const noAuthor = { id: 'r', replyTo: { messageId: 'a' }, createdAt: ts(200) }
  assert.deepEqual(obj(newReplyCounts([noAuthor], 'me', 100)), { a: 1 })
})

test('a reply still being sent (no time yet) is not counted', () => {
  assert.equal(newReplyCounts([msg('r', 'a', null)], 'me', 100).size, 0)
})

test('a message that is not a reply, or a reply to itself, is not counted', () => {
  assert.equal(newReplyCounts([msg('plain', null, 200), msg('self', 'self', 200)], 'me', 100).size, 0)
})

test('times may be plain numbers as well as server times', () => {
  const m = { id: 'r', author: { uid: 'x' }, replyTo: { messageId: 'a' }, createdAt: 200 }
  assert.deepEqual(obj(newReplyCounts([m], 'me', 100)), { a: 1 })
})

test('when the last-read time is not known, nothing is new', () => {
  const list = [msg('r', 'a', 200)]
  for (const unknown of [null, undefined, Number.NaN, Infinity, '100', {}]) {
    assert.equal(newReplyCounts(list, 'me', unknown).size, 0, String(unknown))
  }
})

test('a last-read time of 0 is a real time: everything after it is new', () => {
  assert.equal(newReplyCounts([msg('r', 'a', 5)], 'me', 0).size, 1)
})

test('what has been looked at is not new again: per thread, up to the newest reply seen', () => {
  const list = [msg('r1', 'a', 200), msg('r2', 'a', 300), msg('r3', 'b', 250)]
  assert.deepEqual(obj(newReplyCounts(list, 'me', 100, { a: 200 })), { a: 1, b: 1 }, 'a: only the one after 200')
  assert.deepEqual(obj(newReplyCounts(list, 'me', 100, { a: 300 })), { b: 1 })
  assert.deepEqual(obj(newReplyCounts(list, 'me', 100, { a: 300, b: 250 })), {})
})

test('a thread seen earlier than the conversation was read does not bring replies back', () => {
  assert.equal(newReplyCounts([msg('r', 'a', 150)], 'me', 200, { a: 100 }).size, 0, 'the later of the two stands')
})

test('seen is another thread\'s business: a thread looked at hides nothing in another', () => {
  assert.deepEqual(obj(newReplyCounts([msg('r', 'b', 200)], 'me', 100, { a: 999 })), { b: 1 })
})

test('no messages, or none given, is nothing new', () => {
  assert.equal(newReplyCounts([], 'me', 100).size, 0)
  assert.equal(newReplyCounts(null, 'me', 100).size, 0)
  assert.equal(newReplyCounts(undefined, 'me', 100).size, 0)
})

test('with nobody known to be you, your own replies cannot be told apart, and a reply with no author counts', () => {
  const list = [msg('r', 'a', 200, 'someone')]
  assert.deepEqual(obj(newReplyCounts(list, undefined, 100)), { a: 1 })
})

test('the answer is a map the list can keep: the same counts compare equal', () => {
  const list = [msg('r', 'a', 200)]
  assert.equal(sameCounts(newReplyCounts(list, 'me', 100), newReplyCounts(list, 'me', 100)), true)
  assert.equal(sameCounts(newReplyCounts(list, 'me', 100), newReplyCounts(list, 'me', 300)), false)
})

test('the messages given are left alone', () => {
  const list = [msg('r', 'a', 200)]
  const copy = JSON.stringify(list)
  newReplyCounts(list, 'me', 100, { a: 1 })
  assert.equal(JSON.stringify(list), copy)
})

// ---------- looking at a thread ----------

test('looking at a thread marks it seen up to its newest reply', () => {
  const seen = markThreadSeen({}, 'a', [msg('r1', 'a', 200), msg('r2', 'a', 300), msg('r0', 'a', 100)])
  assert.deepEqual(seen, { a: 300 })
})

test('it never goes back: older replies, or none, change nothing and give the SAME object', () => {
  const seen = { a: 300 }
  assert.equal(markThreadSeen(seen, 'a', [msg('r', 'a', 200)]), seen)
  assert.equal(markThreadSeen(seen, 'a', [msg('r', 'a', 300)]), seen, 'the same time')
  assert.equal(markThreadSeen(seen, 'a', []), seen)
  assert.equal(markThreadSeen(seen, 'a', null), seen)
  assert.equal(markThreadSeen(seen, 'a', undefined), seen)
})

test('a reply still being sent has no time, so it moves nothing', () => {
  const seen = { a: 300 }
  assert.equal(markThreadSeen(seen, 'a', [msg('r', 'a', null)]), seen)
  assert.deepEqual(markThreadSeen({}, 'a', [msg('r', 'a', null), msg('s', 'a', 50)]), { a: 50 })
  assert.deepEqual(markThreadSeen({}, 'a', [msg('r', 'a', null)]), {}, 'nothing seen: nothing recorded')
})

test('a newer reply moves it forward, and other threads are left as they were', () => {
  const seen = { a: 300, b: 40 }
  const next = markThreadSeen(seen, 'a', [msg('r', 'a', 400)])
  assert.deepEqual(next, { a: 400, b: 40 })
  assert.deepEqual(seen, { a: 300, b: 40 }, 'the old one is not changed')
  assert.notEqual(next, seen)
})

test('with nothing recorded yet', () => {
  assert.deepEqual(markThreadSeen(null, 'a', [msg('r', 'a', 5)]), { a: 5 })
  assert.deepEqual(markThreadSeen(undefined, 'a', [msg('r', 'a', 5)]), { a: 5 })
})

test('a thread that has been looked at has nothing new, and a later reply is new again', () => {
  const replies = [msg('r1', 'a', 200), msg('r2', 'a', 300)]
  let seen = markThreadSeen({}, 'a', replies)
  assert.equal(newReplyCounts(replies, 'me', 100, seen).size, 0)
  const later = [...replies, msg('r3', 'a', 400)]
  assert.deepEqual(obj(newReplyCounts(later, 'me', 100, seen)), { a: 1 })
  seen = markThreadSeen(seen, 'a', later)
  assert.equal(newReplyCounts(later, 'me', 100, seen).size, 0)
})

test('the words', () => {
  assert.equal(newRepliesLabel(1), '1 new')
  assert.equal(newRepliesLabel(12), '12 new')
})

// ---------- the screens ----------

test('the chat takes your last-read time when it decides the "New" line, and starts clean when you move', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes("import { currentRoot, markThreadSeen, threadsAllowed } from '../lib/threads'"))
  assert.ok(s.includes('const [readSince, setReadSince] = useState(null) // { path, ms }'))
  assert.ok(s.includes('const [threadSeen, setThreadSeen] = useState({})'))
  assert.ok(s.includes('setReadSince({ path, ms: lastRead?.toMillis?.() ?? null })'), 'the same moment as the "New" line')
  assert.ok(s.includes('    setNewFrom(null)\n    setReadSince(null)\n    setThreadSeen({})\n'), 'a conversation opened again starts from its own time')
  assert.ok(s.includes("newSince={readSince?.path === path ? readSince.ms : null}"), 'not another conversation\'s time')
  assert.ok(s.includes('threadSeen={threadSeen}'))
})

test('the chat records a thread as seen through one steady function', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('const markSeen = useCallback((rootId, replies) => setThreadSeen(prev => markThreadSeen(prev, rootId, replies)), [])'))
  assert.ok(s.includes('onSend={threadSend}\n          onSeen={markSeen}'))
})

test('the panel says what it has shown, as it changes, once its replies are in', () => {
  const p = read('src/components/ThreadPanel.jsx')
  assert.ok(p.includes('onClose, onSeen = null, readOnly = false })'))
  assert.ok(p.includes('useEffect(() => { if (loaded) onSeen?.(root.id, replies) }, [loaded, replies, root.id, onSeen])'))
})

test('the list counts what is new once, and hands the same map on while nothing moved', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes("import { newReplyCounts, newRepliesLabel, replyCounts as countReplies, replyLabel, sameCounts } from '../lib/threads'"))
  assert.ok(l.includes('  newSince = null, '))
  assert.ok(l.includes('  threadSeen = null, '))
  assert.ok(l.includes('const next = newReplyCounts(messages, meUid, newSince, threadSeen)'))
  assert.ok(l.includes('if (sameCounts(newCountsRef.current, next)) return newCountsRef.current'))
  assert.ok(l.includes('newCountsRef.current = next'))
  assert.ok(l.includes('}, [messages, meUid, newSince, threadSeen])'))
  assert.ok(l.includes('newReplies={newReplies}'))
  assert.ok(l.includes('newReplyCount={newReplies?.get(m.id) || 0}'), 'down to the row as a number: the row is memoised')
})

test('the chip says how many are new, beside how many replies there are, and only when some are', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('{replyLabel(replyCount)}\n                {newReplyCount > 0 && ('))
  assert.ok(l.includes('data-new-replies>\n                    {newRepliesLabel(newReplyCount)}'))
})
