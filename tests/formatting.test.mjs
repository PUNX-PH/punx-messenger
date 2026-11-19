// Formatting the selected text in the message box: bold, italic, strikethrough, code, spoiler.
//
//   node --test tests/formatting.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { FORMATS, FORMAT_BUTTONS, formatShortcut, applyFormat } from '../src/lib/formatting.js'
import { tokenizeInline } from '../src/lib/inlineTokens.js'
import { shortcutGroups } from '../src/lib/shortcuts.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
// The new text and what is selected in it, as one thing to compare.
const run = (text, start, end, name) => {
  const r = applyFormat(text, start, end, name)
  return { text: r.text, sel: r.text.slice(r.start, r.end), start: r.start, end: r.end }
}
// Selecting `word` inside `text`.
const on = (text, word, name, nth = 0) => {
  let from = -1
  for (let i = 0; i <= nth; i++) from = text.indexOf(word, from + 1)
  return run(text, from, from + word.length, name)
}

// ---------- what there is ----------

test('the formats and their marks', () => {
  assert.deepEqual(FORMATS, {
    bold: ['**', '**'],
    italic: ['_', '_'],
    strike: ['~~', '~~'],
    code: ['`', '`'],
    spoiler: ['||', '||'],
  })
})

test('the buttons: the same formats, in this order, with words, and shortcuts for two', () => {
  assert.deepEqual(FORMAT_BUTTONS.map(b => b.name), ['bold', 'italic', 'strike', 'code', 'spoiler'])
  for (const b of FORMAT_BUTTONS) assert.ok(b.label.length > 3 && FORMATS[b.name], b.name)
  assert.deepEqual(FORMAT_BUTTONS.filter(b => b.shortcut).map(b => [b.name, b.shortcut]), [['bold', 'B'], ['italic', 'I']])
})

test('what each format writes is read back as that format by the renderer', () => {
  const kind = { bold: 'bold', italic: 'italic', strike: 'strike', code: 'code', spoiler: 'spoiler' }
  for (const name of Object.keys(FORMATS)) {
    const r = on('say hello now', 'hello', name)
    const pieces = tokenizeInline(r.text)
    assert.ok(pieces.some(p => p.type === kind[name]), `${name}: ${r.text}`)
  }
})

test('italic is not mistaken for half of a bold, and bold is not for two italics', () => {
  const boldOnly = on('say hello now', 'hello', 'bold').text
  assert.deepEqual(tokenizeInline(boldOnly).map(p => p.type), ['text', 'bold', 'text'])
  const italicOnly = on('say hello now', 'hello', 'italic').text
  assert.deepEqual(tokenizeInline(italicOnly).map(p => p.type), ['text', 'italic', 'text'])
})

// ---------- the keys ----------

const key = (k, over = {}) => ({ key: k, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...over })

test('Ctrl+B is bold and Ctrl+I is italic, with Cmd on a Mac, in either case', () => {
  assert.equal(formatShortcut(key('b')), 'bold')
  assert.equal(formatShortcut(key('B')), 'bold')
  assert.equal(formatShortcut(key('i')), 'italic')
  assert.equal(formatShortcut(key('I')), 'italic')
  assert.equal(formatShortcut(key('b', { ctrlKey: false, metaKey: true })), 'bold')
  assert.equal(formatShortcut(key('i', { ctrlKey: false, metaKey: true })), 'italic')
})

test('no other key, and none without Ctrl or Cmd', () => {
  for (const k of ['a', 'u', 'e', 'x', 'k', 's', 'Enter', 'ArrowUp', '']) assert.equal(formatShortcut(key(k)), null, k)
  assert.equal(formatShortcut(key('b', { ctrlKey: false })), null)
  assert.equal(formatShortcut(key('i', { ctrlKey: false })), null)
})

test('not with Alt or Shift held (those are other shortcuts), nor while an input method is composing', () => {
  assert.equal(formatShortcut(key('b', { altKey: true })), null)
  assert.equal(formatShortcut(key('b', { shiftKey: true })), null)
  assert.equal(formatShortcut(key('i', { altKey: true })), null)
  assert.equal(formatShortcut(key('i', { shiftKey: true })), null)
  assert.equal(formatShortcut(key('b', { isComposing: true })), null)
})

test('no key press at all, or one with no key', () => {
  assert.equal(formatShortcut(null), null)
  assert.equal(formatShortcut(undefined), null)
  assert.equal(formatShortcut({ ctrlKey: true }), null)
})

// ---------- wrapping a selection ----------

test('a selection is wrapped in the marks, and the selection stays on the words', () => {
  assert.deepEqual(on('say hello now', 'hello', 'bold'), { text: 'say **hello** now', sel: 'hello', start: 6, end: 11 })
  assert.deepEqual(on('say hello now', 'hello', 'italic'), { text: 'say _hello_ now', sel: 'hello', start: 5, end: 10 })
  assert.deepEqual(on('say hello now', 'hello', 'strike'), { text: 'say ~~hello~~ now', sel: 'hello', start: 6, end: 11 })
  assert.deepEqual(on('say hello now', 'hello', 'code'), { text: 'say `hello` now', sel: 'hello', start: 5, end: 10 })
  assert.deepEqual(on('say hello now', 'hello', 'spoiler'), { text: 'say ||hello|| now', sel: 'hello', start: 6, end: 11 })
})

test('the whole text, the start, the end', () => {
  assert.equal(run('hello', 0, 5, 'bold').text, '**hello**')
  assert.equal(on('hello world', 'hello', 'bold').text, '**hello** world')
  assert.equal(on('hello world', 'world', 'bold').text, 'hello **world**')
})

test('several words, with their spaces between', () => {
  assert.deepEqual(on('the ending is ok', 'ending is', 'spoiler'), { text: 'the ||ending is|| ok', sel: 'ending is', start: 6, end: 15 })
})

test('formatting twice in a row (selection kept) takes it off again, and off then on is the same as on', () => {
  const once = on('say hello now', 'hello', 'bold')
  const twice = run(once.text, once.start, once.end, 'bold')
  assert.deepEqual(twice, { text: 'say hello now', sel: 'hello', start: 4, end: 9 })
  const thrice = run(twice.text, twice.start, twice.end, 'bold')
  assert.deepEqual(thrice, once)
})

test('every format toggles', () => {
  for (const name of Object.keys(FORMATS)) {
    const once = on('say hello now', 'hello', name)
    const twice = run(once.text, once.start, once.end, name)
    assert.equal(twice.text, 'say hello now', name)
    assert.equal(twice.sel, 'hello', name)
  }
})

test('selecting the marks too takes them off', () => {
  assert.deepEqual(run('say **hello** now', 4, 13, 'bold'), { text: 'say hello now', sel: 'hello', start: 4, end: 9 })
  assert.deepEqual(run('say ||hi|| now', 4, 10, 'spoiler'), { text: 'say hi now', sel: 'hi', start: 4, end: 6 })
})

test('a different format on formatted words adds to it: bold, then italic', () => {
  const bold = on('say hello now', 'hello', 'bold')
  const both = run(bold.text, bold.start, bold.end, 'italic')
  assert.equal(both.text, 'say **_hello_** now')
  assert.equal(both.sel, 'hello')
  // The bold's marks are outside the italic's: pressing bold again still takes the bold off.
  const offBold = run(both.text, both.start, both.end, 'bold')
  assert.deepEqual(offBold, { text: 'say _hello_ now', sel: 'hello', start: 5, end: 10 })
  const offItalic = run(both.text, both.start, both.end, 'italic')
  assert.deepEqual(offItalic, { text: 'say **hello** now', sel: 'hello', start: 6, end: 11 })
})

test('through several layers: bold, italic, strike, spoiler, in any order, each comes off alone', () => {
  let r = { text: 'say hello now', start: 4, end: 9 }
  for (const name of ['bold', 'italic', 'strike', 'spoiler']) r = run(r.text, r.start, r.end, name)
  assert.equal(r.text, 'say **_~~||hello||~~_** now', 'each new format goes directly around the words, so the first is outermost')
  for (const name of ['bold', 'italic', 'strike', 'spoiler']) {
    const off = run(r.text, r.start, r.end, name)
    assert.equal(off.sel, 'hello', name)
    assert.equal(off.text.includes(FORMATS[name][0]), false, name + ' gone')
    for (const other of ['bold', 'italic', 'strike', 'spoiler'].filter(n => n !== name)) assert.ok(off.text.includes(FORMATS[other][0]), other + ' kept when ' + name + ' comes off')
  }
})

test('a mark of the same kind NOT around the words is not mistaken for theirs', () => {
  // Bold words, then a separate bold word: selecting the second one adds bold, it does not take the first away.
  const t = '**one** two'
  assert.equal(on(t, 'two', 'bold').text, '**one** **two**')
  // Marks around something else on the line.
  assert.equal(on('_a_ b', 'b', 'italic').text, '_a_ _b_')
})

test('stepping out through other marks only when they really surround it on both sides', () => {
  // An italic mark on the left only: not a layer, so bold is added directly.
  assert.equal(on('_hello now', 'hello', 'bold').text, '_**hello** now')
  assert.equal(on('hello_ now', 'hello', 'bold').text, '**hello**_ now')
})

test('taking bold off words that are bold and italic', () => {
  const t = 'say _**hello**_ now'
  const r = run(t, t.indexOf('hello'), t.indexOf('hello') + 5, 'bold')
  assert.equal(r.text, 'say _hello_ now')
  assert.equal(r.sel, 'hello')
})

// ---------- spaces ----------

test('spaces at the ends of a selection stay outside the marks (a spoiler cannot start or end with one)', () => {
  assert.deepEqual(run('say  secret  now', 3, 13, 'spoiler'), { text: 'say  ||secret||  now', sel: 'secret', start: 7, end: 13 })
  assert.deepEqual(run(' x ', 0, 3, 'bold'), { text: ' **x** ', sel: 'x', start: 3, end: 4 })
})

test('and what it writes is a spoiler', () => {
  const r = run('say  secret  now', 3, 13, 'spoiler')
  assert.ok(tokenizeInline(r.text).some(p => p.type === 'spoiler'))
})

test('a tab or a line break at the end is a space too', () => {
  assert.equal(run('hello\t', 0, 6, 'bold').text, '**hello**\t')
  assert.equal(run('hello\n', 0, 6, 'bold').text, '**hello**\n')
})

// ---------- nothing selected ----------

test('with nothing selected, the pair of marks goes in at the cursor, the cursor between them', () => {
  assert.deepEqual(run('say  now', 4, 4, 'spoiler'), { text: 'say |||| now', sel: '', start: 6, end: 6 })
  assert.deepEqual(run('', 0, 0, 'bold'), { text: '****', sel: '', start: 2, end: 2 })
  assert.deepEqual(run('abc', 3, 3, 'code'), { text: 'abc``', sel: '', start: 4, end: 4 })
  assert.deepEqual(run('abc', 0, 0, 'italic'), { text: '__abc', sel: '', start: 1, end: 1 })
})

test('at the cursor between an empty pair, it takes the pair away', () => {
  assert.deepEqual(run('say |||| now', 6, 6, 'spoiler'), { text: 'say  now', sel: '', start: 4, end: 4 })
  assert.deepEqual(run('****', 2, 2, 'bold'), { text: '', sel: '', start: 0, end: 0 })
})

test('only spaces selected counts as nothing selected', () => {
  assert.deepEqual(run('a   b', 1, 4, 'bold'), { text: 'a   ****b', sel: '', start: 6, end: 6 })
})

test('a cursor beside a mark, but not between a pair, adds a pair', () => {
  assert.equal(run('a**b', 3, 3, 'bold').text, 'a******b')
  assert.equal(run('abc**', 3, 3, 'bold').text, 'abc******', 'before a closing mark with no opening one')
  assert.equal(run('**abc', 2, 2, 'bold').text, '******abc', 'after an opening mark with no closing one')
})

test('a selected empty pair is taken away, like the cursor between one', () => {
  assert.deepEqual(run('say |||| now', 4, 8, 'spoiler'), { text: 'say  now', sel: '', start: 4, end: 4 })
  assert.deepEqual(run('****', 0, 4, 'bold'), { text: '', sel: '', start: 0, end: 0 })
})

// ---------- marks on one side only: nothing is lost ----------

test('marks on ONE side of the words are not a pair: the words are wrapped, and nothing is cut', () => {
  assert.deepEqual(on('**hello now', 'hello', 'bold'), { text: '****hello** now', sel: 'hello', start: 4, end: 9 })
  assert.deepEqual(on('hello** now', 'hello', 'bold'), { text: '**hello**** now', sel: 'hello', start: 2, end: 7 })
})

test('a selection that starts with the marks but does not end with them is wrapped, not unwrapped', () => {
  assert.deepEqual(run('**hello now', 0, 7, 'bold').text, '****hello** now')
  assert.deepEqual(run('say hello** now', 4, 11, 'bold').text, 'say **hello**** now')
})

test('too short to be marks and words: "**" alone is an empty pair, "*" is not', () => {
  assert.equal(run('*x*', 0, 3, 'bold').text, '***x***'.replace('***x***', '**' + '*x*' + '**'))
})

// ---------- a selection that ends inside a line ----------

test('a selection that ends before a line break stops there: only what is selected is marked', () => {
  assert.deepEqual(run('hello\nworld', 0, 3, 'bold'), { text: '**hel**lo\nworld', sel: 'hel', start: 2, end: 5 })
  assert.deepEqual(run('hello\nworld', 6, 9, 'bold').text, 'hello\n**wor**ld')
})

test('a selection that starts after a line break and ends after the next one', () => {
  assert.equal(run('ab\ncd\nef', 1, 7, 'bold').text, 'a**b**\n**cd**\n**e**f')
})

// ---------- several lines ----------

test('a selection of several lines is marked line by line, since the marks cannot cross a line break', () => {
  const r = run('one\ntwo\nthree', 0, 13, 'italic')
  assert.equal(r.text, '_one_\n_two_\n_three_')
  assert.equal(r.sel, 'one_\n_two_\n_three')
})

test('empty lines in between are left empty', () => {
  assert.equal(run('one\n\nthree', 0, 10, 'bold').text, '**one**\n\n**three**')
})

test('spaces at the ends of each line stay outside', () => {
  assert.equal(run(' one \n two ', 0, 11, 'spoiler').text, ' ||one|| \n ||two|| ')
})

test('taking it off several lines', () => {
  const r = run('_one_\n_two_', 0, 11, 'italic')
  assert.equal(r.text, 'one\ntwo')
  assert.equal(r.sel, 'one\ntwo')
})

test('some lines marked and some not: all end up marked, none twice', () => {
  const r = run('_one_\ntwo', 0, 9, 'italic')
  assert.equal(r.text, '_one_\n_two_')
})

test('lines of the selection only: the rest of the text is not touched', () => {
  assert.equal(run('keep\nthis\nand that', 5, 9, 'bold').text, 'keep\n**this**\nand that')
})

test('what is written line by line is read back as pieces on each line', () => {
  const r = run('one\ntwo', 0, 7, 'spoiler')
  assert.equal(tokenizeInline(r.text).filter(p => p.type === 'spoiler').length, 2)
})

test('another format with its mark on ONE side only is not a layer to step through', () => {
  // "**_hello!**": the "_" before the words has no partner after them (a "!" is there), so the bold's
  // marks are not around the words in layers: bold is added, and nothing is dropped.
  const t = '**_hello!** now'
  const from = t.indexOf('hello')
  const r = run(t, from, from + 5, 'bold')
  assert.equal(r.text.length, t.length + 4)
  assert.ok(r.text.includes('**hello**'), 'just the words are wrapped')
  // and the other way round
  const u = '**hello_!** now'
  const r2 = run(u, 2, 7, 'bold')
  assert.equal(r2.text.length, u.length + 4)
})

test('a marker that opens on one side and closes with another format is not a pair (nothing is cut)', () => {
  // "**_hello**": the bold's marks are there, but the italic opens inside and never closes: the words
  // are not "inside bold with something else around them", so bold is added, and nothing is cut.
  const t = '**_hello** now'
  const from = t.indexOf('hello')
  const r = run(t, from, from + 5, 'bold')
  assert.equal(r.text.length, t.length + 4)
  assert.ok(r.text.includes('hello'))
})

// ---------- odd input ----------

test('a selection given backwards is the same as forwards', () => {
  assert.deepEqual(run('say hello now', 9, 4, 'bold'), run('say hello now', 4, 9, 'bold'))
})

test('a selection past the end, or before the start, or not a number, is held to the text', () => {
  assert.equal(run('abc', 0, 99, 'bold').text, '**abc**')
  assert.equal(run('abc', -5, 3, 'bold').text, '**abc**')
  assert.deepEqual(run('abc', Number.NaN, Number.NaN, 'bold'), { text: '****abc', sel: '', start: 2, end: 2 })
  assert.deepEqual(run('abc', undefined, undefined, 'bold').text, '****abc')
})

test('no text, or text that is not text, is treated as empty', () => {
  assert.equal(applyFormat(null, 0, 0, 'bold').text, '****')
  assert.equal(applyFormat(undefined, 0, 0, 'bold').text, '****')
  assert.equal(applyFormat(5, 0, 0, 'bold').text, '****')
})

test('a format that does not exist changes nothing', () => {
  assert.deepEqual(applyFormat('abc', 1, 2, 'underline'), { text: 'abc', start: 1, end: 2 })
  assert.deepEqual(applyFormat('abc', 1, 2, undefined), { text: 'abc', start: 1, end: 2 })
  assert.deepEqual(applyFormat('abc', 9, 9, 'nope'), { text: 'abc', start: 3, end: 3 })
})

test('emoji and accents are one thing each', () => {
  assert.equal(on('say héllo 😀 now', 'héllo', 'bold').text, 'say **héllo** 😀 now')
  assert.equal(on('say 😀 now', '😀', 'spoiler').text, 'say ||😀|| now')
})

test('mentions and links in the selection are wrapped with the rest', () => {
  assert.equal(on('hi <@abcdef12> see https://x.test ok', '<@abcdef12>', 'spoiler').text, 'hi ||<@abcdef12>|| see https://x.test ok')
})

// ---------- the box ----------

test('the box formats the selection it has, puts the selection back on the words, and does nothing while sending', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes("import { applyFormat, formatShortcut } from '../lib/formatting'"))
  assert.ok(c.includes("import FormatBar from './FormatBar'"))
  assert.ok(c.includes('  const format = (name) => {\n    const ta = taRef.current\n    if (!ta || sending || disabled) return\n    const r = applyFormat(text, ta.selectionStart ?? text.length, ta.selectionEnd ?? text.length, name)\n    updateText(r.text)\n    requestAnimationFrame(() => {\n      ta.focus()\n      ta.setSelectionRange(r.start, r.end)\n    })\n  }'))
})

test('the keys are handled in the box, and stop the browser from doing its own thing', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('const fmt = formatShortcut(e)\n              if (fmt) { e.preventDefault(); format(fmt); return }'))
  // after the lists for mentions and emoji (they own the keys while open), before sending
  assert.ok(c.indexOf('const fmt = formatShortcut(e)') > c.indexOf("if (e.key === 'Escape') { e.preventDefault(); setEmojiSug(null); return }"))
  assert.ok(c.indexOf('const fmt = formatShortcut(e)') < c.indexOf('if (shouldSend(e, sendKey))'))
})

test('the buttons are a row above the box, opened and shut by "Aa", and not while a voice message is recorded', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('const [formatOpen, setFormatOpen] = useState(false)'))
  assert.ok(c.includes('{formatOpen && !voice && <FormatBar onFormat={format} disabled={sending || disabled} />}'))
  assert.ok(c.includes('onClick={() => setFormatOpen(o => !o)}\n          title="Formatting"\n          aria-label="Formatting"\n          aria-pressed={formatOpen}'))
})

test('pressing a button does not take the selection out of the box, and says which button it was', () => {
  const f = read('src/components/FormatBar.jsx')
  assert.ok(f.includes("onMouseDown={(e) => e.preventDefault()}"))
  assert.ok(f.includes('onClick={() => onFormat(b.name)}'))
  assert.ok(f.includes('{FORMAT_BUTTONS.map(b => ('))
  assert.ok(f.includes('role="toolbar" aria-label="Format the selected text"'))
  assert.ok(f.includes("title={b.shortcut ? `${b.label} (Ctrl/⌘+${b.shortcut})` : b.label}"))
  assert.ok(f.includes('disabled={disabled}'))
  assert.ok(f.includes('aria-label={b.label}'), 'a name for a screen reader, since the buttons show only a letter or a picture')
  assert.ok(f.includes('aria-hidden="true"'), 'the letters and the picture are not read as well')
})

// ---------- the shortcuts sheet ----------

test('the shortcuts sheet lists the two keys, with the words for them', () => {
  const items = shortcutGroups().flatMap(g => g.items)
  const bold = items.find(i => i.id === 'format-bold')
  const italic = items.find(i => i.id === 'format-italic')
  assert.deepEqual(bold.keys, ['mod', 'B'])
  assert.deepEqual(italic.keys, ['mod', 'I'])
  assert.match(bold.does, /bold/)
  assert.match(italic.does, /italic/)
  // and they are in the Writing group
  const writing = shortcutGroups().find(g => g.title === 'Writing')
  assert.ok(writing.items.some(i => i.id === 'format-bold') && writing.items.some(i => i.id === 'format-italic'))
})

test('what the sheet says is what formatShortcut does', () => {
  assert.equal(formatShortcut(key('b')), 'bold')
  assert.equal(formatShortcut(key('i')), 'italic')
})
