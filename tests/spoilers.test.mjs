// Spoilers: ||text|| is hidden until pressed, and stays hidden wherever text is shown as plain text.
//
//   node --test tests/spoilers.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SPOILER_SOURCE, SPOILER_PLACEHOLDER, isSpoiler, spoilerInner, hideSpoilers } from '../src/lib/spoilers.js'
import { INLINE_KINDS, tokenizeInline } from '../src/lib/inlineTokens.js'
import { forwardPreview } from '../src/lib/forward.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const kinds = (text) => tokenizeInline(text).map(t => t.type)
const raws = (text) => tokenizeInline(text).map(t => t.raw)

// ---------- what is a spoiler ----------

test('the placeholder and the pattern', () => {
  assert.equal(SPOILER_PLACEHOLDER, '[spoiler]')
  assert.equal(typeof SPOILER_SOURCE, 'string')
  assert.doesNotMatch('x', new RegExp(`(${SPOILER_SOURCE})`))
})

test('bars that touch the words on both sides are a spoiler', () => {
  for (const s of ['||x||', '||secret||', '||the butler did it||', '||a b c||', '||1||', '||é||', '||a.b!||', '||[x]||', '||https://x.test||']) {
    assert.equal(isSpoiler(s), true, s)
  }
})

test('bars with a space just inside are not (code, tables, "a || b")', () => {
  for (const s of ['|| x ||', '||x ||', '|| x||', '||  ||', '|| ||', '||\tx||', '||x\t||']) assert.equal(isSpoiler(s), false, JSON.stringify(s))
})

test('nothing inside is not a spoiler', () => {
  for (const s of ['||||', '|||', '||', '|']) assert.equal(isSpoiler(s), false, s)
})

test('no bar, and no line break, inside', () => {
  for (const s of ['||a|b||', '||a||b||', '||a\nb||', '||a\n||', '||\na||']) assert.equal(isSpoiler(s), false, JSON.stringify(s))
})

test('it must be the whole piece', () => {
  for (const s of ['x||a||', '||a||x', ' ||a||', '||a|| ']) assert.equal(isSpoiler(s), false, JSON.stringify(s))
  assert.equal(isSpoiler(null), false)
  assert.equal(isSpoiler(undefined), false)
  assert.equal(isSpoiler(5), false)
  // Something that only turns into a spoiler when it is made into text is not text.
  assert.equal(isSpoiler(['||a||']), false)
  assert.equal(isSpoiler({ toString: () => '||a||' }), false)
})

test('what is inside, without the bars', () => {
  assert.equal(spoilerInner('||secret||'), 'secret')
  assert.equal(spoilerInner('||a b||'), 'a b')
  assert.equal(spoilerInner('||x||'), 'x')
})

// ---------- hiding it as plain text ----------

test('each spoiler becomes "[spoiler]", the rest is left as it was', () => {
  assert.equal(hideSpoilers('the ending is ||the butler||!'), 'the ending is [spoiler]!')
  assert.equal(hideSpoilers('||a|| and ||b||'), '[spoiler] and [spoiler]')
  assert.equal(hideSpoilers('||only||'), '[spoiler]')
  assert.equal(hideSpoilers('nothing to hide'), 'nothing to hide')
  assert.equal(hideSpoilers(''), '')
})

test('things that only look like a spoiler stay as they are', () => {
  for (const s of ['a || b || c', 'x || y', 'if (a || b) {}', '||||', '|| ||', 'a | b', '|||']) assert.equal(hideSpoilers(s), s, s)
})

test('hiding twice is hiding once', () => {
  const once = hideSpoilers('a ||b|| c')
  assert.equal(hideSpoilers(once), once)
})

test('what is not text comes back as it was', () => {
  assert.equal(hideSpoilers(null), null)
  assert.equal(hideSpoilers(undefined), undefined)
  assert.equal(hideSpoilers(5), 5)
  const o = { a: 1 }
  assert.equal(hideSpoilers(o), o)
})

test('nothing of the hidden words is left, including with emoji, mentions and links inside', () => {
  const hidden = hideSpoilers('see ||:fire: <@abcdef12> https://x.test/s||')
  assert.equal(hidden, 'see [spoiler]')
})

test('the same pattern again and again (it remembers where it stopped, and must not)', () => {
  for (let i = 0; i < 5; i++) assert.equal(hideSpoilers('a ||b|| c ||d||'), 'a [spoiler] c [spoiler]')
})

// ---------- finding it among the other pieces ----------

test('the kinds, and their order: spoilers last, so nothing else moves', () => {
  assert.deepEqual(INLINE_KINDS, ['code', 'bold', 'strike', 'italic', 'italic', 'url', 'emoji', 'mention', 'spoiler'])
})

test('a spoiler is found as a piece of its own, with words either side', () => {
  assert.deepEqual(kinds('the ending is ||the butler|| really'), ['text', 'spoiler', 'text'])
  assert.deepEqual(raws('the ending is ||the butler|| really'), ['the ending is ', '||the butler||', ' really'])
})

test('a spoiler alone, at the start, at the end', () => {
  assert.deepEqual(kinds('||x||'), ['spoiler'])
  assert.deepEqual(kinds('||x|| after'), ['spoiler', 'text'])
  assert.deepEqual(kinds('before ||x||'), ['text', 'spoiler'])
})

test('several in one message', () => {
  assert.deepEqual(kinds('||a|| and ||b||'), ['spoiler', 'text', 'spoiler'])
  assert.deepEqual(kinds('||a||||b||'), ['spoiler', 'spoiler'])
})

test('not a spoiler: no piece of that kind', () => {
  for (const t of ['a || b || c', '||||', '|| x ||', 'x || y', '||a|b||']) assert.ok(!kinds(t).includes('spoiler'), t)
})

test('every other piece is still found exactly as before', () => {
  assert.deepEqual(kinds('`c` **b** ~~s~~ *i* _j_ https://x.test :fire: <@abcdef12>'), ['code', 'text', 'bold', 'text', 'strike', 'text', 'italic', 'text', 'italic', 'text', 'url', 'text', 'emoji', 'text', 'mention'])
})

test('code wins where it starts first: bars inside code are not a spoiler', () => {
  assert.deepEqual(kinds('`a||b||c`'), ['code'])
})

test('a spoiler that starts first wins over what is inside it', () => {
  assert.deepEqual(kinds('||**bold** and :fire:||'), ['spoiler'])
})

test('a piece before a spoiler on the same line does not swallow it', () => {
  assert.deepEqual(kinds('**b** ||s||'), ['bold', 'text', 'spoiler'])
  assert.deepEqual(kinds('https://x.test ||s||'), ['url', 'text', 'spoiler'])
})

test('a link directly against a spoiler: the link takes the bars (it ends at a space or a bracket only)', () => {
  assert.deepEqual(kinds('||https://x.test||'), ['spoiler'], 'the spoiler starts first')
})

test('the pieces cover the text exactly once, in order', () => {
  const text = 'a ||b|| **c** :d: https://e.test <@abcdef12> ||f|| g'
  assert.equal(tokenizeInline(text).map(t => t.raw).join(''), text)
  const t = tokenizeInline(text)
  let at = 0
  for (const p of t) { assert.equal(p.index, at); at += p.raw.length }
})

test('nothing, or not text, is no pieces', () => {
  assert.deepEqual(tokenizeInline(''), [])
  assert.deepEqual(tokenizeInline(null), [])
  assert.deepEqual(tokenizeInline(undefined), [])
  assert.deepEqual(tokenizeInline(5), [])
  assert.deepEqual(tokenizeInline(['||a||']), [], 'a list that turns into text is not text')
  assert.deepEqual(tokenizeInline({ toString: () => '||a||' }), [])
})

test('links and emoji are found in any case, as they always were', () => {
  assert.deepEqual(kinds(':FIRE:'), ['emoji'])
  assert.deepEqual(kinds('HTTPS://EXAMPLE.TEST'), ['url'])
  assert.deepEqual(kinds('<@ABCDEF12>'), ['mention'])
})

test('what is inside a spoiler is tokenised again on its own, like any text', () => {
  assert.deepEqual(kinds(spoilerInner('||**bold** :fire: <@abcdef12>||')), ['bold', 'text', 'emoji', 'text', 'mention'])
})

test('tokenising twice gives the same, whatever came before (no memory between calls)', () => {
  const a = tokenizeInline('a ||b|| c')
  tokenizeInline('||x|| ||y|| ||z||')
  assert.deepEqual(tokenizeInline('a ||b|| c'), a)
})

// ---------- plain-text places ----------

test('the preview of a forward does not show a spoiler', () => {
  assert.equal(forwardPreview({ text: 'the end: ||dies||' }), 'the end: [spoiler]')
})

test('the reply quote, the conversation preview, the composer\'s "replying to" and the places that list messages hide spoilers', () => {
  const db = read('src/lib/db.js')
  assert.ok(db.includes("import { hideSpoilers } from './spoilers'"))
  assert.ok(db.includes("snippet:    (hideSpoilers(replyTo.text) || (replyTo.imageURL ? '[image]' : replyTo.audioURL ? '[voice message]' : '')).slice(0, 160),"), 'written hidden')
  assert.ok(db.includes("lastMessageText: hideSpoilers(trimmed) || (audio ? '🎤 Voice message' : '📷 Image'),"))
  assert.ok(read('src/components/MessageList.jsx').includes('{hideSpoilers(message.replyTo.snippet)}'), 'shown hidden even if an older client wrote it')
  assert.ok(read('src/components/Composer.jsx').includes("{hideSpoilers(replyingTo.text) || (replyingTo.imageURL ? '[image]' : '')}"))
  assert.ok(read('src/components/SearchDropdown.jsx').includes('highlight(hideSpoilers(m.text), parsed.text)'))
  assert.ok(read('src/components/ChatSurface.jsx').includes('{hideSpoilers(m.text)}</div>'), 'the pinned list')
})

test('notifications do not say what is hidden', () => {
  const n = read('src/lib/notifications.jsx')
  assert.ok(n.includes("import { hideSpoilers } from './spoilers'"))
  assert.ok(n.includes("body: hideSpoilers(dm.lastMessageText) || '',"))
  assert.ok(n.includes("body: hideSpoilers(m.text) || (m.imageURL ? '[image]' : ''),"))
})

test('copying a message still copies what was written, and forwarding keeps the spoiler', () => {
  assert.ok(!read('src/lib/copyText.js').includes('hideSpoilers'))
  assert.ok(read('src/lib/forward.js').includes('const text = hideSpoilers(copyableText(message, usersById))'), 'only the preview')
  assert.ok(!read('src/lib/forward.js').match(/text:\s*hideSpoilers/), 'what is sent is the original')
})

// ---------- drawing it ----------

test('the renderer takes its pieces from the tokenizer, and draws a spoiler hidden until pressed', () => {
  const m = read('src/lib/markdown.jsx')
  assert.ok(m.includes("import { useState } from 'react'"))
  assert.ok(m.includes("import { tokenizeInline } from './inlineTokens'"))
  assert.ok(m.includes("import { spoilerInner } from './spoilers'"))
  assert.ok(m.includes('for (const t of tokenizeInline(text)) {'))
  assert.ok(!m.includes('INLINE_RE'), 'the old expression, which was shared and so could not be used inside itself, is gone')
  assert.ok(m.includes("} else if (t.type === 'spoiler') {"))
  assert.ok(m.includes('<Spoiler key={key}>{renderInline(spoilerInner(raw), { emojiByName, usersById, emojiSize, kStart: i })}</Spoiler>'), 'what is inside is drawn like any text')
})

test('a hidden spoiler is a button: keyboard, read out as a spoiler, not read, not clicked through', () => {
  const m = read('src/lib/markdown.jsx')
  assert.ok(m.includes('role="button"\n      tabIndex={0}\n      aria-label="Spoiler, press to show"'))
  assert.ok(m.includes("onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show() } }}"))
  assert.ok(m.includes('<span aria-hidden="true" className="pointer-events-none">{children}</span>'))
  assert.ok(m.includes('className="spoiler-hidden rounded px-0.5 bg-ink-dim select-none cursor-pointer"'))
})

test('pressing it shows it for good', () => {
  const m = read('src/lib/markdown.jsx')
  assert.ok(m.includes('const [shown, setShown] = useState(false)'))
  assert.ok(m.includes('if (shown) return <span className="rounded px-0.5 bg-bg-hover" data-spoiler="shown">{children}</span>'))
  assert.ok(m.includes('const show = () => setShown(true)'))
})

test('whatever is inside a hidden spoiler is invisible, in either theme: colours, borders, emoji', () => {
  const c = read('src/index.css')
  assert.ok(c.includes('.spoiler-hidden,\n.spoiler-hidden * {\n  color: transparent !important;\n  background: transparent !important;\n  border-color: transparent !important;'))
  assert.ok(c.includes('.spoiler-hidden { background: rgb(var(--ink-dim)) !important; }'), 'the bar is a theme colour, not a fixed one')
  assert.ok(c.includes('.spoiler-hidden img { visibility: hidden; }'))
})
