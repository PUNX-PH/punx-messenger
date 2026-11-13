// ":emoji:" suggestions in the message box: when the colon counts, what is offered and in what
// order, what is written when one is picked, and that the box is wired to it.
//
//   node --test tests/emoji-suggest.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  MAX_SUGGESTIONS, MIN_QUERY, UNICODE_EMOJIS, applySuggestion, detectEmojiQuery, suggestEmojis, suggestionToken,
} from '../src/lib/emojiSuggest.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const names = (items) => items.map((i) => i.name)

// ---------- when the colon counts ----------

test('a colon at the start or after a space, then two or more name characters, at the caret', () => {
  assert.deepEqual(detectEmojiQuery(':fi', 3), { startIdx: 0, query: 'fi' })
  assert.deepEqual(detectEmojiQuery('hello :fire', 11), { startIdx: 6, query: 'fire' })
  assert.deepEqual(detectEmojiQuery('line one\n:th', 12), { startIdx: 9, query: 'th' })
  assert.deepEqual(detectEmojiQuery('ok :+1', 6), { startIdx: 3, query: '+1' })
  assert.deepEqual(detectEmojiQuery('ok :-1', 6), { startIdx: 3, query: '-1' })
  assert.deepEqual(detectEmojiQuery(':white_check_mark', 17), { startIdx: 0, query: 'white_check_mark' })
  assert.deepEqual(detectEmojiQuery(':FIRE', 5), { startIdx: 0, query: 'FIRE' }, 'any case')
})

test('it follows the caret, not the end of the text', () => {
  assert.deepEqual(detectEmojiQuery('say :fi and more', 7), { startIdx: 4, query: 'fi' })
  assert.equal(detectEmojiQuery('say :fi and more', 16), null)
  assert.equal(detectEmojiQuery('say :fi', 3), null, 'caret before the colon')
})

test('times, links, smileys and one letter are not taken', () => {
  for (const [v, c] of [
    ['at 10:30', 8], ['see http://x.test', 17], ['a :)', 4], [':o', 2], [':', 1], ['hi :', 4], ['hi :3', 5],
    ['at :30', 6], ['a::fire', 7], ['x:fire', 6], [':fire:', 6], [':fi re', 6], ['`:fire', 6],
  ]) assert.equal(detectEmojiQuery(v, c), null, v)
})

test('the name stops at 32 characters', () => {
  assert.ok(detectEmojiQuery(':' + 'a'.repeat(32), 33))
  assert.equal(detectEmojiQuery(':' + 'a'.repeat(33), 34), null)
})

test('odd input does not throw', () => {
  for (const [v, c] of [[null, 1], [undefined, 1], [5, 1], [':fi', null], [':fi', undefined], [':fi', -1], [':fi', 1.5], [':fi', NaN], ['', 0]]) {
    assert.equal(detectEmojiQuery(v, c), null)
  }
})

// ---------- what is offered ----------

test('nothing for less than two characters, a blank, or something that is not text', () => {
  assert.equal(MIN_QUERY, 2)
  for (const q of ['', 'f', ' ', ' f ', null, undefined, 5]) assert.deepEqual(suggestEmojis(q), [], String(q))
})

test('the everyday ones match by name, and by the other names people type', () => {
  assert.equal(suggestEmojis('fire')[0].char, '🔥')
  assert.deepEqual(suggestEmojis('lol')[0], { kind: 'unicode', name: 'lol', char: '😂' })
  assert.deepEqual(suggestEmojis('+1')[0], { kind: 'unicode', name: '+1', char: '👍' })
  assert.deepEqual(suggestEmojis('-1')[0], { kind: 'unicode', name: '-1', char: '👎' })
  assert.equal(suggestEmojis('THUMBSUP')[0].char, '👍', 'any case')
  assert.equal(suggestEmojis(' fire ')[0].char, '🔥', 'around the edges is ignored')
})

test('the match shown is the name that matched', () => {
  assert.equal(suggestEmojis('thanks')[0].name, 'thanks')
  assert.equal(suggestEmojis('pray')[0].name, 'pray')
  assert.equal(suggestEmojis('pray')[0].char, suggestEmojis('thanks')[0].char)
})

test('exact first, then starts-with, then contains', () => {
  const out = names(suggestEmojis('heart', { limit: 50 }))
  assert.equal(out[0], 'heart')
  assert.ok(out.indexOf('heart_eyes') < out.indexOf('blue_heart'), 'starts with before contains')
  assert.ok(out.indexOf('heart') < out.indexOf('heart_eyes'))
})

test('within the same kind of match, by name', () => {
  const out = names(suggestEmojis('smi', { limit: 50 }))
  const starts = out.filter((n) => n.startsWith('smi'))
  const contains = out.filter((n) => !n.startsWith('smi'))
  assert.deepEqual(out, [...starts, ...contains], 'starts-with first')
  assert.deepEqual(starts, [...starts].sort((a, b) => a.localeCompare(b)))
  assert.deepEqual(contains, [...contains].sort((a, b) => a.localeCompare(b)))
  assert.ok(starts.length > 1 && contains.length > 1)
})

test('at most the limit, eight by default, and nothing for a limit of zero or less', () => {
  assert.equal(MAX_SUGGESTIONS, 8)
  assert.ok(suggestEmojis('ee').length > 3, 'there is plenty to cut')
  assert.ok(suggestEmojis('ee').length <= 8)
  assert.equal(suggestEmojis('ee', { limit: 3 }).length, 3)
  assert.deepEqual(suggestEmojis('ee', { limit: 0 }), [])
  assert.deepEqual(suggestEmojis('ee', { limit: -2 }), [], 'a negative limit does not mean "all but the last"')
})

test('the best of an emoji\'s names is the one that counts, not the first that matches', () => {
  // "white_check_mark" only contains "check"; "check" is exact.
  const out = suggestEmojis('check')
  assert.deepEqual(out[0], { kind: 'unicode', name: 'check', char: '✅' })
})

test('ties are broken by name, not by where they sit in the table', () => {
  const out = names(suggestEmojis('hea', { limit: 50 }))
  const starts = out.filter((n) => n.startsWith('hea'))
  assert.ok(starts.length >= 4, 'several that start the same way')
  assert.deepEqual(starts, [...starts].sort((x, y) => x.localeCompare(y)))
})

test('nothing for a name that is not there', () => {
  assert.deepEqual(suggestEmojis('zzzzqq'), [])
})

const custom = [
  { name: 'fire_dance', dataURL: 'data:image/png;base64,AAA' },
  { name: 'fire', dataURL: 'data:image/png;base64,BBB' },
  { name: 'partyparrot', dataURL: 'data:image/png;base64,CCC' },
]

test('the workspace\'s own emoji are offered, with their picture', () => {
  const out = suggestEmojis('parrot', { custom })
  assert.deepEqual(out, [{ kind: 'custom', name: 'partyparrot', dataURL: 'data:image/png;base64,CCC' }])
})

test('with the same match, the workspace\'s own come before the everyday ones', () => {
  const out = suggestEmojis('fire', { custom })
  assert.deepEqual(out.slice(0, 2).map((i) => [i.kind, i.name]), [['custom', 'fire'], ['unicode', 'fire']])
  // a better match still wins: the exact everyday one is above a custom one that only starts with it
  const out2 = suggestEmojis('fir', { custom: [{ name: 'firefly', dataURL: 'data:x' }] })
  assert.equal(out2[0].kind, 'custom')
  const out3 = suggestEmojis('fire', { custom: [{ name: 'campfire', dataURL: 'data:x' }] })
  assert.equal(out3[0].kind, 'unicode', 'exact everyday beats a custom that only contains it')
})

test('a broken custom emoji is skipped rather than throwing', () => {
  const bad = [null, undefined, {}, { name: 5, dataURL: 'x' }, { name: 'fireworks' }, { name: 'fireworks', dataURL: 7 }, 'fire', []]
  assert.doesNotThrow(() => suggestEmojis('fire', { custom: bad }))
  assert.ok(suggestEmojis('fire', { custom: bad }).every((i) => i.kind === 'unicode'))
  assert.doesNotThrow(() => suggestEmojis('fire', { custom: null }))
  assert.doesNotThrow(() => suggestEmojis('fire', { custom: 'nope' }))
})

test('a custom name in capitals still matches', () => {
  assert.equal(suggestEmojis('partyt', { custom: [{ name: 'PartyTime', dataURL: 'data:x' }] })[0].kind, 'custom')
})

// ---------- what the table holds ----------

test('every everyday emoji has a usual name, unique names, and a real character', () => {
  const all = UNICODE_EMOJIS.flatMap((e) => e.names)
  assert.equal(new Set(all).size, all.length, 'no name is used twice')
  assert.ok(UNICODE_EMOJIS.length >= 100)
  for (const e of UNICODE_EMOJIS) {
    assert.equal(e.name, e.names[0])
    assert.ok(e.names.every((n) => /^[a-z0-9_+-]{2,32}$/.test(n)), e.name)
    assert.ok(e.char.length > 0 && !/^[\x00-\x7f]*$/.test(e.char) && !/\s/.test(e.char), e.name)
  }
})

test('no invisible character sits raw in the file: the picture-form marker is written by its code', () => {
  const BS = String.fromCharCode(92)
  const hex = ['200B', '200C', '200D', '200E', '200F', '202A', '202B', '202C', '202D', '202E', '2060', '2066', '2067', '2068', '2069', 'FE0F', 'FEFF']
  const raw = new RegExp('[' + hex.map((h) => BS + 'u' + h).join('') + ']')
  assert.ok(!raw.test(read('src/lib/emojiSuggest.js')))
  // and the symbols that need it do have it
  for (const n of ['heart', 'warning', 'heavy_check_mark', 'sunny', 'cloud', 'snowflake']) {
    const e = UNICODE_EMOJIS.find((x) => x.name === n)
    assert.equal(e.char.codePointAt(e.char.length - 1), 0xFE0F, n)
  }
})

// ---------- writing the pick ----------

const fire = { kind: 'unicode', name: 'fire', char: '🔥' }
const parrot = { kind: 'custom', name: 'partyparrot', dataURL: 'data:x' }

test('a custom emoji is written as its :name: token, an everyday one as the character', () => {
  assert.equal(suggestionToken(parrot), ':partyparrot:')
  assert.equal(suggestionToken(fire), '🔥')
})

test('the typed :query is replaced, a space follows, and the caret goes after it', () => {
  const r = applySuggestion('hello :fi', 6, 'fi', fire)
  assert.deepEqual(r, { text: 'hello 🔥 ', caret: 'hello 🔥 '.length })
  const p = applySuggestion(':parr', 0, 'parr', parrot)
  assert.deepEqual(p, { text: ':partyparrot: ', caret: ':partyparrot: '.length })
})

test('text after the caret is kept, and no second space is added when there already is one', () => {
  assert.deepEqual(applySuggestion('a :fi b', 2, 'fi', fire), { text: 'a 🔥 b', caret: 'a 🔥'.length })
  assert.deepEqual(applySuggestion('a :fi\nb', 2, 'fi', fire), { text: 'a 🔥\nb', caret: 'a 🔥'.length })
  assert.deepEqual(applySuggestion('a :fi', 2, 'fi', fire), { text: 'a 🔥 ', caret: 'a 🔥 '.length })
})

test('what comes before is untouched, including earlier colons', () => {
  const r = applySuggestion('re: 10:30 :fi', 10, 'fi', fire)
  assert.equal(r.text, 're: 10:30 🔥 ')
})

test('detect, suggest and apply agree end to end', () => {
  const text = 'ship it :roc'
  const d = detectEmojiQuery(text, text.length)
  const top = suggestEmojis(d.query)[0]
  assert.equal(top.char, '🚀')
  assert.equal(applySuggestion(text, d.startIdx, d.query, top).text, 'ship it 🚀 ')
})

// ---------- wired together ----------

test('the box detects on typing, on click and on caret keys, and shows the list only with matches', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes("import { applySuggestion, detectEmojiQuery, suggestEmojis } from '../lib/emojiSuggest'"))
  assert.ok(c.includes('detectEmoji(v, e.target.selectionStart)'))
  assert.ok(c.includes('detectEmoji(text, e.target.selectionStart)'))
  assert.equal(c.split('detectEmoji(').length - 1, 3, 'called on change, click and key up')
  assert.ok(c.includes('const suggestOpen = !!emojiSug && emojiCandidates.length > 0'))
  assert.ok(c.includes('{suggestOpen && ('))
  assert.ok(c.includes('suggestEmojis(emojiSug.query, { custom: customEmojis })'))
})

test('Up, Down, Enter, Tab and Esc work the list while it is open, and Enter does not send then', () => {
  const c = read('src/components/Composer.jsx')
  const at = c.indexOf('if (suggestOpen) {')
  assert.ok(at > 0)
  const block = c.slice(at, c.indexOf("if (mention && mentionCandidates.length > 0) {", at))
  for (const k of ["'ArrowDown'", "'ArrowUp'", "'Enter' || e.key === 'Tab'", "'Escape'"]) assert.ok(block.includes(k), k)
  assert.ok(block.includes('pickEmoji(emojiCandidates[at])'))
  assert.ok(block.includes('!e.isComposing'), 'an input method confirming a word does not pick')
  // checked before the @ list and before sending
  assert.ok(at < c.indexOf('shouldSend(e, sendKey)'))
})

test('picking closes the list, moves the caret after the emoji, and is cleared on send and on switching chat', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('applySuggestion(text, emojiSug.startIdx, emojiSug.query, item)'))
  assert.ok(c.includes('setSelectionRange(caret, caret)'))
  assert.ok(c.includes("setText(''); setFile(null); setEmojiSug(null)"))
  assert.ok(c.includes('setMention(null)\n    setEmojiSug(null)'))
})

test('the list keeps its place while the same thing is typed, and goes away when it is not a query any more', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('setEmojiSug(prev => (prev && prev.startIdx === d.startIdx && prev.query === d.query ? prev : { ...d, selectedIdx: 0 }))'))
  assert.ok(c.includes('if (!d) { setEmojiSug(null); return }'))
})

test('the highlight stays inside the list', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('const at = Math.min(emojiSug.selectedIdx, last)'))
  assert.ok(c.includes('selectedIdx: Math.min(at + 1, last)'))
  assert.ok(c.includes('selectedIdx: Math.max(at - 1, 0)'))
  assert.ok(c.includes('selectedIdx={Math.min(emojiSug.selectedIdx, emojiCandidates.length - 1)}'))
})

test('picking with the mouse keeps the cursor in the box, and closes the list', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('onMouseDown={(e) => { e.preventDefault(); onPick(it) }}'))
  const pick = c.slice(c.indexOf('const pickEmoji = (item) => {'), c.indexOf('const onTextChange'))
  assert.ok(pick.includes('setEmojiSug(null)'))
})

test('the up arrow still edits the last message only when no list is open, including this one', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('|| suggestOpen }'))
})

test('the list does not collide with the picker button\'s own state', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('const [emojiOpen, setEmojiOpen] = useState(false)'))
  assert.ok(c.includes('const suggestOpen'))
})
