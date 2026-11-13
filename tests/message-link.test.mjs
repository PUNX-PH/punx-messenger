// A link to one message in a channel: how it is written and read, how a link is followed, and
// that the pieces are wired together.
//
//   node --test tests/message-link.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { LINK_LOOKBACK, MESSAGE_PARAM, messageIdFromSearch, messageLink, nextLinkStep } from '../src/lib/messageLink.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const ORIGIN = 'https://plexus.punxai.online'
const CH = 'groups/G1abc/channels/C2def/messages'

// ---------- writing a link ----------

test('a channel message gets the address of its channel with the message in the query', () => {
  assert.equal(messageLink(ORIGIN, CH, 'Xy12abCD'), 'https://plexus.punxai.online/g/G1abc/c/C2def?m=Xy12abCD')
  assert.equal(messageLink('http://localhost:5173', CH, 'a_b-1'), 'http://localhost:5173/g/G1abc/c/C2def?m=a_b-1')
  assert.equal(MESSAGE_PARAM, 'm')
})

test('a DM, your notes, or any other path has no link', () => {
  assert.equal(messageLink(ORIGIN, 'dms/abc_def/messages', 'x1'), null)
  assert.equal(messageLink(ORIGIN, 'users/me/notes', 'x1'), null)
  assert.equal(messageLink(ORIGIN, 'groups/G1/channels/C1', 'x1'), null)
  assert.equal(messageLink(ORIGIN, 'groups/G1/channels/C1/messages/extra', 'x1'), null)
  assert.equal(messageLink(ORIGIN, 'groups/G1/messages', 'x1'), null)
  assert.equal(messageLink(ORIGIN, '/groups/G1/channels/C1/messages', 'x1'), null)
  assert.equal(messageLink(ORIGIN, 'groups/G 1/channels/C1/messages', 'x1'), null)
  assert.equal(messageLink(ORIGIN, 'groups//channels/C1/messages', 'x1'), null)
  for (const p of [null, undefined, '', 5, {}]) assert.equal(messageLink(ORIGIN, p, 'x1'), null)
})

test('an unusable message id or origin gives no link rather than a broken one', () => {
  for (const id of ['', 'a b', 'a/b', 'a&m=2', 'a#b', 'a?b', '<x>', 'x'.repeat(65), null, undefined, 7]) assert.equal(messageLink(ORIGIN, CH, id), null, String(id))
  for (const o of ['', 'plexus.punxai.online', 'ftp://x.test', 'https://', 'https://a.test/', 'https://a.test/path', 'https://a b.test', null, undefined]) assert.equal(messageLink(o, CH, 'x1'), null, String(o))
  assert.ok(messageLink(ORIGIN, CH, 'x'.repeat(64)))
})

// ---------- reading a link ----------

test('the id comes back out of a link, from the router\'s params or a query string', () => {
  const url = new URL(messageLink(ORIGIN, CH, 'Xy12abCD'))
  assert.equal(messageIdFromSearch(url.searchParams), 'Xy12abCD')
  assert.equal(messageIdFromSearch(url.search), 'Xy12abCD')
  assert.equal(messageIdFromSearch('m=abc'), 'abc')
  assert.equal(messageIdFromSearch('settings=1&m=abc'), 'abc')
  assert.equal(messageIdFromSearch(new URLSearchParams('m=first&m=second')), 'first')
})

test('no id, or something that is not a plain id, is ignored', () => {
  for (const q of ['', 'settings=1', 'm=', 'm=a%20b', 'm=<script>', 'm=a/b', 'm=' + 'x'.repeat(65), 'M=abc', 'mm=abc']) assert.equal(messageIdFromSearch(q), null, q)
  for (const x of [null, undefined, 5, {}, []]) assert.equal(messageIdFromSearch(x), null)
})

test('the address a link makes is a real route of the app', () => {
  const app = read('src/App.jsx')
  assert.ok(app.includes('path="/g/:groupId/c/:channelId"'))
})

// ---------- following a link ----------

const msgs = (ids) => ids.map((id) => ({ id }))
const step = (over) => nextLinkStep({ target: 't', loaded: true, messages: msgs(['a', 'b']), hasMore: false, limit: 50, loadedLimit: 50, ...over })

test('no link, or the messages not here yet: nothing to do', () => {
  assert.equal(step({ target: null }), 'none')
  assert.equal(step({ target: undefined }), 'none')
  assert.equal(step({ target: '' }), 'none')
  assert.equal(step({ loaded: false }), 'wait')
  assert.equal(step({ loaded: false, messages: msgs(['t']) }), 'wait', 'another conversation\'s messages are never searched')
})

test('a message that is on screen is jumped to, whatever else is true', () => {
  assert.equal(step({ messages: msgs(['a', 't']) }), 'jump')
  assert.equal(step({ messages: msgs(['t']), hasMore: true, loadedLimit: LINK_LOOKBACK }), 'jump')
})

test('one that is not on screen but may be further back widens the window once', () => {
  assert.equal(step({ hasMore: true }), 'lookback')
  assert.equal(step({ hasMore: true, limit: LINK_LOOKBACK - 1 }), 'lookback')
  // asked for, and the bigger window has not arrived yet: wait, do not ask again
  assert.equal(step({ hasMore: true, limit: LINK_LOOKBACK, loadedLimit: 50 }), 'wait')
  assert.equal(step({ hasMore: true, limit: LINK_LOOKBACK + 50, loadedLimit: 50 }), 'wait')
})

test('one that is not there after everything was loaded, or after the big window, is missing', () => {
  assert.equal(step({ hasMore: false }), 'missing')
  assert.equal(step({ hasMore: false, messages: [] }), 'missing', 'an empty conversation')
  assert.equal(step({ hasMore: true, limit: LINK_LOOKBACK, loadedLimit: LINK_LOOKBACK }), 'missing')
  assert.equal(step({ hasMore: true, limit: LINK_LOOKBACK, loadedLimit: LINK_LOOKBACK + 50 }), 'missing')
})

test('odd input does not throw', () => {
  assert.equal(step({ messages: undefined, hasMore: false }), 'missing')
  assert.equal(step({ messages: [null, undefined, {}], hasMore: false }), 'missing')
  assert.equal(nextLinkStep({ target: 't', loaded: true }), 'missing')
})

// A model of the chat: it holds the newest `limit` of `n` messages; asking for a bigger window gives the bigger one.
function simulate(n, targetIndex, firstPage = 50) {
  const ids = Array.from({ length: n }, (_, i) => 'id' + i)
  const target = targetIndex === null ? 'absent' : ids[targetIndex]
  let limit = firstPage
  let arrived = limit
  const steps = []
  for (let i = 0; i < 6; i++) {
    const shown = ids.slice(Math.max(0, n - arrived))
    const s = nextLinkStep({ target, loaded: true, messages: msgs(shown), hasMore: n >= arrived, limit, loadedLimit: arrived })
    steps.push(s)
    if (s === 'jump' || s === 'missing') return steps
    if (s === 'lookback') { limit = LINK_LOOKBACK; continue }
    arrived = limit // 'wait': the window arrives
  }
  return steps
}

test('following a link always ends, asks for a wider window at most once, and finds what is within reach', () => {
  for (const n of [0, 1, 30, 49, 50, 51, 120, 299, 300, 301, 500, 2000]) {
    for (const idx of [null, 0, Math.floor(n / 3), n - 1].filter((x) => x === null || (n > 0 && x >= 0 && x < n))) {
      const steps = simulate(n, idx)
      const last = steps[steps.length - 1]
      assert.ok(last === 'jump' || last === 'missing', `n=${n} idx=${idx} ended on ${last}: ${steps}`)
      assert.ok(steps.filter((s) => s === 'lookback').length <= 1, `n=${n} idx=${idx} asked twice: ${steps}`)
      const reachable = idx !== null && idx >= n - LINK_LOOKBACK
      assert.equal(last, reachable ? 'jump' : 'missing', `n=${n} idx=${idx}: ${steps}`)
      if (idx !== null && idx >= n - 50) assert.deepEqual(steps, ['jump'], 'on the first page: no widening')
    }
  }
})

// ---------- wired together ----------

test('the chat follows ?m=, widens once, says so when it is gone, and removes the parameter either way', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('const linkTarget = messageIdFromSearch(searchParams)'))
  assert.ok(s.includes("const step = nextLinkStep({ target: linkTarget, loaded, messages, hasMore, limit, loadedLimit: batch.limit })"))
  assert.ok(s.includes("if (step === 'none' || step === 'wait') return"))
  assert.ok(s.includes("if (step === 'lookback') { setLimit(LINK_LOOKBACK); return }"))
  assert.ok(s.includes("if (step === 'jump') jumpTo(linkTarget)"))
  assert.ok(s.includes("That message isn't here any more."))
  assert.ok(s.includes('n.delete(MESSAGE_PARAM)'))
  assert.ok(s.includes('{ replace: true })'))
  // the note goes away by itself, and with the conversation
  assert.ok(s.includes('useEffect(() => { setLinkNote(null) }, [path])'))
  assert.ok(s.includes('setTimeout(() => setLinkNote(null), 8000)'))
  // It floats over the top of the list: in the column it would shrink the list and unstick it from the bottom.
  assert.ok(s.includes('className="absolute top-14 left-4 right-4 z-10 '))
  assert.ok(s.includes('<main className="relative flex-1 flex flex-col'))
})

test('the window size is remembered with each batch, so a bigger window is told from the old one', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('useState({ path: null, docs: NO_MESSAGES, limit: 0 })'))
  assert.ok(s.includes('{ path, docs, limit }'))
})

test('Copy link is offered only where there is a link, and copies the address of this message', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes("const hasLinks = messageLink('https://x.example', path, 'a') !== null"))
  assert.ok(s.includes('copyToClipboard(messageLink(window.location.origin, path, m.id))'))
  assert.ok(s.includes('onCopyLink={hasLinks ? copyLink : null}'))
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('onCopyLink = null,'))
  assert.ok(l.includes('{onCopyLink && ('))
  assert.ok(l.includes('if (await onCopyLink(message)) flashLinkCopied()'))
  assert.ok(l.includes("title={linkCopied ? 'Link copied' : 'Copy link'}"))
  assert.ok(l.includes("aria-label={linkCopied ? 'Link copied' : 'Copy link'}"))
  assert.ok(l.includes('{linkCopied ? <CheckIcon /> : <LinkIcon />}'))
  assert.ok(l.includes('canCopy || onCopyLink || canPin'))
  // threaded through the group to every row
  assert.equal(l.split('onCopyLink={onCopyLink}').length - 1, 2)
})

test('a link is a thing anyone who can see the message may copy: not tied to edit, delete or read-only', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(!/\{onCopyLink && [^\n]*(canEdit|canDelete|readOnly)/.test(l))
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(!/onCopyLink=\{[^}]*readOnly/.test(s))
})
