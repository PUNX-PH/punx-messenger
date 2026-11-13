// The chat background patterns: that each one is well drawn, that nothing in them can
// carry a colour of its own (so they take the theme's), and that the generated
// stylesheet is the one these definitions produce.
//
//   node --test tests/chat-patterns.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  CHAT_PATTERNS, PATTERN_GROUPS, PATTERN_STRENGTHS, MARK_H, MARK_W, patternSvg, patternsCss,
} from '../src/lib/chatPatterns.js'

const drawn = CHAT_PATTERNS.filter(p => p.body)
const lf = (s) => s.replace(/\r\n/g, '\n')

test('ids are unique, safe to put in a selector, and "none" is first and draws nothing', () => {
  const ids = CHAT_PATTERNS.map(p => p.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/)
  assert.equal(CHAT_PATTERNS[0].id, 'none')
  assert.equal(CHAT_PATTERNS[0].body, undefined)
})

test('every pattern is in a known group, and every group has patterns', () => {
  for (const p of CHAT_PATTERNS) assert.ok(PATTERN_GROUPS.includes(p.group), p.id)
  for (const g of PATTERN_GROUPS) assert.ok(CHAT_PATTERNS.some(p => p.group === g), g)
})

test('what the person asked for is on the list: the Punx corner watermark and a pattern for each team', () => {
  const ids = CHAT_PATTERNS.map(p => p.id)
  for (const id of ['punx-corner', 'punx-center', 'punx-pattern', 'creatives', 'art2d', 'art3d', 'ailabs', 'gamedev', 'hr', 'dev']) {
    assert.ok(ids.includes(id), id)
  }
})

test('each drawn pattern has a kind and a size', () => {
  assert.ok(drawn.length >= 15)
  for (const p of drawn) {
    assert.ok(['tile', 'corner', 'center'].includes(p.kind), p.id)
    assert.ok(p.w > 0 && p.h > 0, p.id)
  }
})

test('a drawing is well formed: tags open and close, and it has something in it', () => {
  for (const p of drawn) {
    const svg = patternSvg(p)
    const stack = []
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
      const [, closing, name, , selfClosing] = m
      if (selfClosing) continue
      if (closing) assert.equal(stack.pop(), name, p.id + ': mismatched </' + name + '>')
      else stack.push(name)
    }
    assert.deepEqual(stack, [], p.id + ': unclosed tags')
    assert.match(svg, /<(path|circle|rect|polygon)\b/, p.id + ': draws nothing')
    assert.doesNotMatch(svg, /NaN|undefined|\[object/, p.id)
  }
})

test('nothing carries a colour of its own, so every pattern takes the text colour of the theme', () => {
  for (const p of drawn) {
    const svg = patternSvg(p)
    for (const [, c] of svg.matchAll(/(?:fill|stroke)='([^']+)'/g)) {
      assert.ok(c === '#000' || c === 'none', p.id + ' uses ' + c)
    }
    assert.doesNotMatch(svg, /rgb|hsl|currentColor|style=|<image|<script|href=/i, p.id)
  }
})

test('every drawing stays inside its own tile, so a repeat has no cut-off pieces', () => {
  // Coordinates the drawing states outright (absolute points and circles); the lines
  // that deliberately run off the edge to join the next tile are marked by negative
  // numbers and exempt.
  for (const p of drawn.filter(p => p.kind === 'tile')) {
    for (const m of patternSvg(p).matchAll(/<circle cx='([\d.]+)' cy='([\d.]+)' r='([\d.]+)'/g)) {
      const [cx, cy, r] = [+m[1], +m[2], +m[3]]
      assert.ok(cx - r >= -0.01 && cy - r >= -0.01 && cx + r <= p.w + 0.01 && cy + r <= p.h + 0.01, p.id + ' circle ' + m[0])
    }
    for (const m of patternSvg(p).matchAll(/<rect x='([\d.]+)' y='([\d.]+)' width='([\d.]+)' height='([\d.]+)'/g)) {
      const [x, y, w, h] = [+m[1], +m[2], +m[3], +m[4]]
      assert.ok(x + w <= p.w + 0.01 && y + h <= p.h + 0.01, p.id + ' rect ' + m[0])
    }
  }
})

test('the Punx mark has the logo\'s proportions: 198 by 39, solid letters', () => {
  assert.equal(MARK_W, 198)
  assert.equal(MARK_H, 39)
  const corner = CHAT_PATTERNS.find(p => p.id === 'punx-corner')
  assert.equal(corner.w / corner.h, 198 / 39)
  const svg = patternSvg(corner)
  assert.equal((svg.match(/<polygon/g) || []).length, 3, 'the diagonals of the N and the X')
  assert.doesNotMatch(svg, /opacity/, 'letters are solid; the whole mark is faded by the mask, so overlaps cannot show')
})

test('the generated stylesheet is the one the definitions produce', () => {
  const committed = lf(fs.readFileSync('src/patterns.css', 'utf8'))
  assert.equal(committed, patternsCss(), 'src/patterns.css is out of date: run  node scripts/gen-patterns.mjs')
})

test('the stylesheet has a rule for every drawn pattern and none for "none"', () => {
  const css = fs.readFileSync('src/patterns.css', 'utf8')
  for (const p of drawn) assert.ok(css.includes(`html[data-pattern="${p.id}"] .chat-pattern {`), p.id)
  assert.ok(!css.includes('data-pattern="none"'))
  for (const s of PATTERN_STRENGTHS.filter(s => s.id !== 'normal')) {
    assert.ok(css.includes(`data-pattern-strength="${s.id}"`), s.id)
  }
  assert.ok(!css.includes('data-pattern-strength="normal"'))
})

test('the stylesheet takes its colour from the theme and holds no colour of its own', () => {
  const css = fs.readFileSync('src/patterns.css', 'utf8')
  assert.ok(css.includes('rgb(var(--ink) /'))
  const outsideUrls = css.replace(/url\("[^"]*"\)/g, '')
  assert.doesNotMatch(outsideUrls, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(outsideUrls, /\brgba?\((?!var\(--ink\))/)
})

test('a pattern never gets in the way of the messages', () => {
  const css = fs.readFileSync('src/patterns.css', 'utf8')
  assert.ok(/::before \{[^}]*pointer-events: none/.test(css), 'clicks pass through it')
  assert.ok(/::before \{[^}]*z-index: -1/.test(css), 'it sits behind the text')
  assert.ok(css.includes('isolation: isolate'), 'and stays behind it rather than behind the page')
})

test('strengths are faint: none is bold enough to matter for reading', () => {
  for (const s of PATTERN_STRENGTHS) assert.ok(s.alpha > 0 && s.alpha <= 0.14, s.id)
  const alphas = PATTERN_STRENGTHS.map(s => s.alpha)
  assert.deepEqual(alphas, [...alphas].sort((a, b) => a - b), 'subtle < normal < strong')
  // A single large mark is multiplied up a little; even then it stays well under 0.2.
  for (const p of CHAT_PATTERNS) assert.ok(!p.strength || p.strength * PATTERN_STRENGTHS.at(-1).alpha < 0.2, p.id)
})

test('the message area carries the class the stylesheet draws on, for the full chat, the empty one and the loading pane', () => {
  const src = lf(fs.readFileSync('src/components/MessageList.jsx', 'utf8'))
  // Three places: full, empty, and the blank pane shown while a conversation loads (the
  // background must not flash off while switching chats).
  assert.equal((src.match(/className="chat-pattern /g) || []).length, 3)
  assert.ok(src.includes('<div className="chat-pattern flex-1" role="status" aria-busy="true"'), 'the loading pane has it')
})

test('the stylesheet is loaded by the app', () => {
  assert.match(fs.readFileSync('src/main.jsx', 'utf8'), /import '\.\/patterns\.css'/)
})

test('labels are plain, short and different from each other (they are what the picker shows)', () => {
  const labels = CHAT_PATTERNS.map(p => p.label)
  for (const l of labels) { assert.equal(l, l.trim()); assert.ok(l.length > 0 && l.length <= 14, l) }
  assert.equal(new Set(labels.map(l => l.toLowerCase())).size, labels.length)
})
