// Copy a message's text: what is copied, how it reaches the clipboard, and that the button is wired.
//
//   node --test tests/copy-text.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { copyableText, hasCopyableText, UNKNOWN_MENTION } from '../src/lib/copyText.js'
import { copyToClipboard } from '../src/lib/clipboard.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

// ---------- what is copied ----------

test('a plain message is copied as written', () => {
  assert.equal(copyableText({ text: 'see you at 3' }), 'see you at 3')
})

test('formatting is kept, so it works when pasted back into a message', () => {
  const t = '**bold** and `code` and\n```\nblock\n```\n:wave:'
  assert.equal(copyableText({ text: t }), t)
})

test('a mention is written as @Name, not as its internal token', () => {
  const users = { abc123: { name: 'Ana Reyes' }, 'x-y_zz9': { name: ' Ben ' } }
  assert.equal(copyableText({ text: 'hi <@abc123>, and <@x-y_zz9>!' }, users), 'hi @Ana Reyes, and @Ben!')
  assert.equal(copyableText({ text: '<@abc123> <@abc123>' }, users), '@Ana Reyes @Ana Reyes')
})

test('a mention of someone not in the directory, or with no usable name, never leaks the token', () => {
  assert.equal(copyableText({ text: 'ping <@gone123>' }, {}), 'ping ' + UNKNOWN_MENTION)
  assert.equal(copyableText({ text: 'ping <@gone123>' }), 'ping ' + UNKNOWN_MENTION)
  assert.equal(copyableText({ text: 'ping <@abc123>' }, { abc123: { name: '   ' } }), 'ping ' + UNKNOWN_MENTION)
  assert.equal(copyableText({ text: 'ping <@abc123>' }, { abc123: { name: 42 } }), 'ping ' + UNKNOWN_MENTION)
  assert.equal(copyableText({ text: 'ping <@abc123>' }, { abc123: null }), 'ping ' + UNKNOWN_MENTION)
  assert.ok(!copyableText({ text: 'ping <@gone123>' }).includes('<@'))
  // A directory that is null (not yet loaded) rather than missing.
  assert.equal(copyableText({ text: 'ping <@gone123>' }, null), 'ping ' + UNKNOWN_MENTION)
})

test('an unknown mention reads the way the message itself shows it', () => {
  assert.equal(UNKNOWN_MENTION, '@Unknown')
  assert.ok(read('src/lib/markdown.jsx').includes("@{u?.name || 'Unknown'}"))
})

test('what only looks like a mention is left alone', () => {
  assert.equal(copyableText({ text: 'a <@ab> b <@> c @name' }), 'a <@ab> b <@> c @name')
})

test('surrounding blank space is trimmed, inner space is not', () => {
  assert.equal(copyableText({ text: '  \n a  b \n ' }), 'a  b')
})

test('a message with no text gives nothing to copy', () => {
  for (const m of [null, undefined, {}, { text: '' }, { text: '  \n ' }, { text: 7 }, { text: null }, { text: {} }, { imageURL: 'x' }]) {
    assert.equal(hasCopyableText(m), false, JSON.stringify(m))
    assert.equal(copyableText(m), '', JSON.stringify(m))
  }
  assert.equal(hasCopyableText({ text: 'x' }), true)
})

// ---------- the clipboard ----------

const fakeDoc = (over = {}) => {
  const log = []
  const attrs = {}
  const ta = { style: {}, setAttribute(k, v) { attrs[k] = v }, focus() { log.push('ta.focus') }, select() { log.push('select') }, remove() { log.push('remove') }, value: '' }
  const active = { focus() { log.push('active.focus') } }
  const doc = {
    body: { appendChild(el) { log.push('append'); assert.equal(el, ta) } },
    createElement(tag) { assert.equal(tag, 'textarea'); return ta },
    activeElement: active,
    execCommand(cmd) { log.push('exec:' + cmd + ':' + ta.value); return true },
    ...over,
  }
  return { doc, ta, log, attrs }
}

test('the modern clipboard is used when it works', async () => {
  const written = []
  const env = { navigator: { clipboard: { writeText: async (t) => { written.push(t) } } }, document: fakeDoc().doc }
  assert.equal(await copyToClipboard('hello', env), true)
  assert.deepEqual(written, ['hello'])
})

test('when the modern clipboard refuses, the old way is tried, and its result is the answer', async () => {
  const f = fakeDoc()
  const env = { navigator: { clipboard: { writeText: async () => { throw new Error('denied') } } }, document: f.doc }
  assert.equal(await copyToClipboard('hello', env), true)
  assert.equal(f.ta.value, 'hello')
  assert.ok(f.log.includes('exec:copy:hello'))
  const bad = fakeDoc({ execCommand: () => false })
  assert.equal(await copyToClipboard('hello', { navigator: {}, document: bad.doc }), false)
})

test('with no modern clipboard at all, the old way is used', async () => {
  const f = fakeDoc()
  assert.equal(await copyToClipboard('hi', { navigator: {}, document: f.doc }), true)
  assert.ok(f.log.includes('exec:copy:hi'))
  assert.equal(await copyToClipboard('hi', { document: fakeDoc().doc }), true)
})

test('the old way cleans up after itself and gives the cursor back', async () => {
  const f = fakeDoc()
  await copyToClipboard('x', { navigator: {}, document: f.doc })
  assert.deepEqual(f.log.filter((l) => !l.startsWith('exec')), ['append', 'ta.focus', 'select', 'active.focus', 'remove'])
  assert.equal(f.ta.style.left, '-9999px', 'off-screen')
  assert.equal(f.attrs.readonly, '', 'so a phone does not raise its keyboard')
  // ...also when the copy command throws.
  const g = fakeDoc({ execCommand() { throw new Error('boom') } })
  assert.equal(await copyToClipboard('x', { navigator: {}, document: g.doc }), false)
  assert.ok(g.log.includes('remove'))
})

test('without the copy command the old way touches nothing at all', async () => {
  const f = fakeDoc({ execCommand: undefined })
  assert.equal(await copyToClipboard('x', { navigator: {}, document: f.doc }), false)
  assert.deepEqual(f.log, [])
})

test('it never throws, and says false when nothing can copy', async () => {
  assert.equal(await copyToClipboard('x', {}), false)
  assert.equal(await copyToClipboard('x', { navigator: {}, document: {} }), false)
  assert.equal(await copyToClipboard('x', { navigator: {}, document: { body: {} } }), false)
  assert.equal(await copyToClipboard('x', { navigator: {}, document: { body: {}, execCommand() {}, createElement() { throw new Error('no') } } }), false)
})

test('nothing to copy is not copied: an empty text writes nothing', async () => {
  let called = false
  const env = { navigator: { clipboard: { writeText: async () => { called = true } } }, document: fakeDoc().doc }
  assert.equal(await copyToClipboard('', env), false)
  assert.equal(await copyToClipboard(null, env), false)
  assert.equal(await copyToClipboard(undefined, env), false)
  assert.equal(called, false)
})

// ---------- the button ----------

test('each message with text gets a Copy button that uses the shared helpers', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes("import { copyableText, hasCopyableText } from '../lib/copyText'"))
  assert.ok(l.includes("import { copyToClipboard } from '../lib/clipboard'"))
  assert.ok(l.includes('const canCopy = hasCopyableText(message)'))
  assert.ok(l.includes('copyToClipboard(copyableText(message, usersById))'))
  assert.ok(l.includes("title={copied ? 'Copied' : 'Copy text'}"))
  assert.ok(l.includes('{canCopy && ('))
})

test('the toolbar shows for a message that can only be copied, and copying is not tied to edit or read-only', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('{!editing && (onReact || onReply || canCopy || onCopyLink || onForward || canPin || canEdit || canDelete) && ('))
  assert.ok(!/canCopy\s*=\s*[^\n]*(canEdit|readOnly|isAuthor)/.test(l))
})

test('"Copied" only shows after the copy worked, and goes away by itself', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('if (await copyToClipboard(copyableText(message, usersById))) flashCopied()'))
  assert.ok(l.includes('const [copied, flashCopied] = useFlash(1500)'))
  assert.ok(l.includes('{copied ? <CheckIcon /> : <CopyIcon />}'))
  assert.ok(l.includes("aria-label={copied ? 'Copied' : 'Copy text'}"))
  // The flag: on for the time given, restarted by a second click, cleaned up with the row.
  assert.ok(l.includes('timer.current = setTimeout(() => setOn(false), ms)'))
  assert.ok(l.includes('clearTimeout(timer.current)\n    timer.current = setTimeout'))
  assert.ok(l.includes('useEffect(() => () => clearTimeout(timer.current), [])'))
})
