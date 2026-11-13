// The unread badge on the browser tab's icon.
//
//   node --test tests/favicon-badge.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { BADGE_MAX, badgeGeometry, badgeLabel, rgbFromTriplet } from '../src/lib/faviconBadge.js'

const lf = (s) => s.replace(/\r\n/g, '\n')

test('the badge says nothing for nothing new, the number up to nine, and 9+ beyond', () => {
  assert.equal(BADGE_MAX, 9)
  assert.equal(badgeLabel(0), '')
  assert.equal(badgeLabel(1), '1')
  assert.equal(badgeLabel(9), '9')
  assert.equal(badgeLabel(10), '9+')
  assert.equal(badgeLabel(250), '9+')
  assert.equal(badgeLabel(3.7), '3', 'a fraction is not a count')
})

test('anything that is not a positive number gives no badge', () => {
  for (const bad of [undefined, null, NaN, -4, 'x', {}, [], Infinity, 0.4]) assert.equal(badgeLabel(bad), '', String(bad))
  assert.equal(badgeLabel('5'), '5', 'a number as text still counts')
})

test('the badge sits fully inside the icon, in the top-right corner, whatever the size', () => {
  for (const size of [16, 32, 48, 64, 128]) {
    for (const label of ['1', '9', '9+']) {
      const { cx, cy, r, fontPx } = badgeGeometry(size, label)
      assert.ok(r > 0 && fontPx > 0)
      assert.ok(cx + r <= size + 1e-9, `${size}/${label}: right edge inside`)
      assert.ok(cy - r >= -1e-9, `${size}/${label}: top edge inside`)
      assert.ok(cx > size / 2 && cy < size / 2, `${size}/${label}: top-right quarter`)
    }
  }
})

test('the two-character label gets a smaller font, and it still fits inside the circle', () => {
  const one = badgeGeometry(64, '9')
  const two = badgeGeometry(64, '9+')
  assert.ok(two.fontPx < one.fontPx)
  // Roughly: two glyphs at ~0.62em each must be narrower than the circle's diameter.
  assert.ok(two.fontPx * 0.62 * 2 <= two.r * 2, 'two glyphs inside the circle')
})

test('the colour comes from the theme\'s "r g b" value, with a red fallback for anything else', () => {
  assert.equal(rgbFromTriplet('239 68 68'), 'rgb(239,68,68)')
  assert.equal(rgbFromTriplet('  220   38 38 '), 'rgb(220,38,38)')
  const red = 'rgb(239,68,68)'
  for (const bad of ['', undefined, null, '300 0 0', 'red', '1 2', '1 2 3 4', '#ff0000', 'rgb(1,2,3)']) assert.equal(rgbFromTriplet(bad), red, String(bad))
  assert.equal(rgbFromTriplet('x', 'rgb(0,0,0)'), 'rgb(0,0,0)', 'a different fallback')
})

// ---------- the wiring ----------

test('the badge is mounted beside the tab title, for the same people', () => {
  const app = lf(fs.readFileSync('src/App.jsx', 'utf8'))
  assert.ok(app.includes("import FaviconBadge from './components/FaviconBadge'"))
  assert.ok(app.includes('{user && profile && <FaviconBadge />}'), 'only while signed in')
})

test('it shows the same number as the title and obeys the same preference', () => {
  const src = lf(fs.readFileSync('src/components/FaviconBadge.jsx', 'utf8'))
  assert.ok(src.includes('useUnreadCount()'), 'the same count as the title')
  assert.ok(src.includes('badgeLabel(tabTitleCount ? count : 0)'), 'switched off in the preferences: no badge')
})

test('the plain icon comes back at zero, on failure, and on sign-out, and the original is kept once', () => {
  const src = lf(fs.readFileSync('src/components/FaviconBadge.jsx', 'utf8'))
  assert.ok(src.includes('originalHref ??= link.getAttribute(\'href\')'), 'remembered once, before it is ever replaced')
  assert.ok(src.includes("if (!label) { link.setAttribute('href', originalHref); return }"), 'nothing new: plain icon')
  assert.ok(src.includes(".catch(() => { if (!cancelled) link.setAttribute('href', originalHref) })"), 'a failed drawing leaves the plain icon')
  assert.ok(/useEffect\(\(\) => \(\) => \{\n\s*const link = iconLink\(\)\n\s*if \(link && originalHref\) link\.setAttribute\('href', originalHref\)/.test(src), 'unmounting restores it')
  assert.ok(src.includes('if (!cancelled) link.setAttribute('), 'a drawing that finishes after the count changed is dropped')
  assert.ok(src.includes('return () => { cancelled = true }'), 'and the effect cancels the one in flight when the count changes')
})

test('it finds the page\'s own icon link, and the page has exactly one', () => {
  const html = fs.readFileSync('index.html', 'utf8')
  assert.equal((html.match(/<link rel="icon"/g) || []).length, 1)
  assert.ok(lf(fs.readFileSync('src/components/FaviconBadge.jsx', 'utf8')).includes('document.querySelector(\'link[rel="icon"]\')'))
})

test('the drawing is only reachable from the browser: importing the module touches no document', () => {
  const src = lf(fs.readFileSync('src/lib/faviconBadge.js', 'utf8'))
  const top = src.slice(0, src.indexOf('// ---------- the drawing (browser only) ----------'))
  assert.ok(!/document\.|window\.|new Image|canvas/i.test(top.replace(/\/\/.*$/gm, '')), 'the logic above the drawing is DOM-free')
})

test('the preference says it covers the icon too', () => {
  const modal = lf(fs.readFileSync('src/components/PreferencesModal.jsx', 'utf8'))
  assert.ok(modal.includes('label="Unread count in the tab title and icon"'))
  assert.ok(modal.includes('a red badge on the tab icon'))
})
