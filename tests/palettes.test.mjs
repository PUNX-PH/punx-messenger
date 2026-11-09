// Colour is a personal choice, and no choice may make the app unreadable. These
// tests hold every background and every accent, in both themes, to the contrast the
// original design had.
//
//   node --test tests/palettes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contrast, ensureContrast, hexToRgb, hslToRgb, luminance, mix, rgbToHex, rgbToHsl, toChannels, withLuminance,
} from '../src/lib/colorMath.js'
import {
  ACCENTS, DEFAULT_PALETTE, PALETTES, accentVars, backgroundVars, contrastVars, surfacesFor,
} from '../src/lib/palettes.js'

const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]
const SURFACES = ['bgDeepest', 'bgDark', 'bgMain', 'bgRaised', 'bgHover']
const MODES = ['dark', 'light']
const channels = (str) => str.split(' ').map(Number)

// A small seeded generator, so "hundreds of arbitrary colours" is the same hundreds
// every run and a failure can be reproduced.
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}
const randomHex = (r) => rgbToHex([r(), r(), r()].map(v => Math.floor(v * 256)))

// ---------- colour maths ----------

test('hex parsing: three and six digits, with or without #, and rejects the rest', () => {
  assert.deepEqual(hexToRgb('#5865f2'), [88, 101, 242])
  assert.deepEqual(hexToRgb('5865F2'), [88, 101, 242])
  assert.deepEqual(hexToRgb('#fa0'), [255, 170, 0])
  for (const bad of ['', '#12', '#12345', '#1234567', 'red', '#gggggg', null, undefined, 5, {}]) {
    assert.equal(hexToRgb(bad), null, String(bad))
  }
})

test('rgb to hex and back, and the channel form the stylesheet uses', () => {
  assert.equal(rgbToHex([88, 101, 242]), '#5865f2')
  assert.equal(rgbToHex([300, -5, 0.4]), '#ff0000', 'out-of-range is clamped')
  assert.equal(toChannels([88, 101, 242]), '88 101 242')
})

test('hsl round trip stays within a rounding step', () => {
  const r = rng(7)
  for (let i = 0; i < 300; i++) {
    const c = [r(), r(), r()].map(v => Math.floor(v * 256))
    const back = hslToRgb(rgbToHsl(c))
    c.forEach((v, k) => assert.ok(Math.abs(v - back[k]) <= 1, `${c} -> ${back}`))
  }
})

test('luminance and contrast match the WCAG definition', () => {
  assert.equal(luminance(BLACK), 0)
  assert.ok(Math.abs(luminance(WHITE) - 1) < 1e-9)
  assert.ok(Math.abs(contrast(WHITE, BLACK) - 21) < 1e-9)
  assert.ok(Math.abs(contrast(WHITE, WHITE) - 1) < 1e-9)
  assert.equal(contrast([10, 20, 30], [200, 210, 220]), contrast([200, 210, 220], [10, 20, 30]), 'order does not matter')
})

test('withLuminance finds a colour of the requested hue and brightness', () => {
  for (const hue of [0, 60, 150, 218, 270, 322]) {
    for (const y of [0.005, 0.02, 0.1, 0.5, 0.9]) {
      const c = withLuminance(hue, 0.4, y)
      // Colours have 256 steps a channel, so the match is to within a step, not exact.
      assert.ok(Math.abs(luminance(c) - y) < 0.008, `hue ${hue} y ${y}: got ${luminance(c)}`)
    }
  }
})

test('ensureContrast: leaves a good colour alone and fixes a poor one against every background', () => {
  assert.deepEqual(ensureContrast([255, 255, 255], [BLACK], 7, WHITE), [255, 255, 255])
  const bgs = [[20, 20, 20], [60, 60, 60]]
  const fixed = ensureContrast([70, 70, 70], bgs, 4.5, WHITE)
  for (const bg of bgs) assert.ok(contrast(fixed, bg) >= 4.5)
  assert.deepEqual(ensureContrast([100, 100, 100], [[100, 100, 100]], 30, WHITE), WHITE, 'the impossible gives the extreme, not a hang')
})

test('mix', () => {
  assert.deepEqual(mix([0, 0, 0], [100, 200, 50], 0), [0, 0, 0])
  assert.deepEqual(mix([0, 0, 0], [100, 200, 50], 1), [100, 200, 50])
  assert.deepEqual(mix([0, 0, 0], [100, 200, 50], 0.5), [50, 100, 25])
})

// ---------- backgrounds ----------

test('the original background adds no variables at all, so nothing changes for anyone who never opens the settings', () => {
  assert.equal(DEFAULT_PALETTE, 'slate')
  assert.deepEqual(backgroundVars('slate', 'dark'), {})
  assert.deepEqual(backgroundVars('slate', 'light'), {})
  assert.deepEqual(backgroundVars('not-a-palette', 'dark'), {}, 'an unknown one falls back to the original')
})

test('eight backgrounds, each with a name and its own hue', () => {
  assert.equal(PALETTES.length, 8)
  assert.equal(new Set(PALETTES.map(p => p.id)).size, 8)
  assert.equal(new Set(PALETTES.map(p => p.label)).size, 8)
})

test('every background keeps the original brightness of every surface, so text contrast is unchanged', () => {
  const orig = (mode) => surfacesFor('slate', mode)
  for (const p of PALETTES) {
    for (const mode of MODES) {
      const s = surfacesFor(p.id, mode)
      for (const key of [...SURFACES, 'lineSubtle', 'lineStrong']) {
        const want = luminance(orig(mode)[key])
        const got = luminance(s[key])
        // Not an exact match when the light theme's main surface is nudged off pure white
        // (a little darker, never lighter).
        if (mode === 'light' && key === 'bgMain') { assert.ok(got <= want + 1e-9 && got >= 0.9, `${p.id} ${key}`); continue }
        assert.ok(Math.abs(got - want) < 0.006, `${p.id} ${mode} ${key}: ${got} vs ${want}`)
      }
    }
  }
})

test('text keeps at least the original contrast on every surface, for every background and theme', () => {
  for (const mode of MODES) {
    const o = surfacesFor('slate', mode)
    for (const p of PALETTES) {
      const s = surfacesFor(p.id, mode)
      for (const text of ['ink', 'inkMuted', 'inkDim']) {
        for (const key of SURFACES) {
          const was = contrast(o[text], o[key])
          const now = contrast(s[text], s[key])
          // The one deliberate exception: the light theme's main surface, tinted off
          // pure white, so its contrast may dip a little, to a floor far above the minimum.
          if (mode === 'light' && key === 'bgMain') {
            assert.ok(now >= Math.min(was, 15) * 0.95 || now >= 7, `${p.id} ${text} on bgMain: ${now.toFixed(2)}`)
            continue
          }
          // Within 2%: colour channels are whole numbers, and the darkest surfaces are the
          // most sensitive to a single step.
          assert.ok(now >= was * 0.98, `${p.id} ${mode} ${text} on ${key}: ${now.toFixed(2)} vs ${was.toFixed(2)}`)
        }
      }
      // The quiet text (timestamps, hints) must clear the accessible minimum on all of them.
      for (const key of SURFACES) {
        assert.ok(contrast(s.inkDim, s[key]) >= 4.5, `${p.id} ${mode} inkDim on ${key}`)
        assert.ok(contrast(s.inkMuted, s[key]) >= 4.5, `${p.id} ${mode} inkMuted on ${key}`)
      }
    }
  }
})

test('surfaces keep their order (main is the reading surface, deepest the edge)', () => {
  const order = (s) => SURFACES.slice().sort((a, b) => luminance(s[a]) - luminance(s[b]))
  for (const mode of MODES) {
    const want = order(surfacesFor('slate', mode))
    for (const p of PALETTES) assert.deepEqual(order(surfacesFor(p.id, mode)), want, `${p.id} ${mode}`)
  }
})

test('the backgrounds really look different from each other', () => {
  for (const mode of MODES) {
    const seen = new Map()
    for (const p of PALETTES) {
      const key = JSON.stringify(surfacesFor(p.id, mode).bgMain)
      if (mode === 'light' && ['slate', 'charcoal'].includes(p.id)) continue // both plain in the light theme
      assert.ok(!seen.has(key), `${p.id} and ${seen.get(key)} share a main surface in ${mode}`)
      seen.set(key, p.id)
    }
  }
})

test('backgroundVars produces the seven surface and line variables as channel strings', () => {
  const v = backgroundVars('ocean', 'dark')
  assert.deepEqual(Object.keys(v).sort(), [
    '--bg-dark', '--bg-deepest', '--bg-hover', '--bg-main', '--bg-raised', '--line-strong', '--line-subtle',
  ])
  for (const val of Object.values(v)) assert.match(val, /^\d{1,3} \d{1,3} \d{1,3}$/)
})

// ---------- higher contrast ----------

test('higher contrast takes quiet text and edges to at least 7:1 on every surface, for every background', () => {
  for (const mode of MODES) {
    for (const p of PALETTES) {
      const s = surfacesFor(p.id, mode)
      const v = contrastVars(p.id, mode)
      for (const key of SURFACES) {
        assert.ok(contrast(channels(v['--ink-muted']), s[key]) >= 7, `${p.id} ${mode} muted on ${key}`)
        assert.ok(contrast(channels(v['--ink-dim']), s[key]) >= 7, `${p.id} ${mode} dim on ${key}`)
      }
      // Edges are stronger than before (closer to the text colour).
      assert.ok(contrast(channels(v['--line-subtle']), s.bgMain) > contrast(s.lineSubtle, s.bgMain), `${p.id} ${mode} subtle edge`)
    }
  }
})

// ---------- accents ----------

test('nine accents on offer, each a valid colour with a name', () => {
  assert.equal(ACCENTS.length, 9)
  assert.equal(new Set(ACCENTS.map(a => a.id)).size, 9)
  for (const a of ACCENTS) assert.ok(hexToRgb(a.hex), a.id)
})

function checkAccent(hex, mode, bg) {
  const v = accentVars(hex, mode, bg)
  const s = surfacesFor(bg, mode)
  const fill = channels(v['--brand']), hover = channels(v['--brand-hover']), text = channels(v['--brand-text'])
  assert.ok(contrast(WHITE, fill) >= 4.5, `${hex} ${mode} ${bg}: white on fill ${contrast(WHITE, fill).toFixed(2)}`)
  assert.ok(contrast(WHITE, hover) >= 4.5, `${hex} ${mode} ${bg}: white on hover`)
  for (const key of SURFACES) {
    assert.ok(contrast(text, s[key]) >= 4.5, `${hex} ${mode} ${bg}: accent text on ${key} ${contrast(text, s[key]).toFixed(2)}`)
  }
}

test('every accent on offer is readable on every background in both themes', () => {
  for (const a of ACCENTS) for (const p of PALETTES) for (const mode of MODES) checkAccent(a.hex, mode, p.id)
})

test('so is any colour at all: 400 arbitrary ones, plus the awkward extremes', () => {
  const r = rng(20261109)
  const colours = ['#000000', '#ffffff', '#ffff00', '#00ffff', '#ff00ff', '#808080', '#fefefe', '#010101']
  for (let i = 0; i < 400; i++) colours.push(randomHex(r))
  for (const hex of colours) {
    for (const mode of MODES) checkAccent(hex, mode, PALETTES[Math.floor(r() * PALETTES.length)].id)
  }
})

test('an accent that is already readable is not changed more than it has to be', () => {
  const v = accentVars('#3b4cca', 'dark') // already dark enough for white text
  assert.equal(v['--brand'], '59 76 202')
})

test('the hover shade is darker than the fill', () => {
  for (const a of ACCENTS) {
    const v = accentVars(a.hex, 'dark')
    assert.ok(luminance(channels(v['--brand-hover'])) < luminance(channels(v['--brand'])), a.id)
  }
})

test('accent text is lighter than its fill in the dark theme and darker in the light theme', () => {
  for (const a of ACCENTS) {
    const dark = accentVars(a.hex, 'dark'), light = accentVars(a.hex, 'light')
    assert.ok(luminance(channels(dark['--brand-text'])) >= luminance(channels(dark['--brand'])) - 1e-9, `${a.id} dark`)
    assert.ok(luminance(channels(light['--brand-text'])) <= luminance(channels(light['--brand'])) + 1e-9, `${a.id} light`)
  }
})

test('something that is not a colour gives no variables, so it cannot break the page', () => {
  for (const bad of ['', 'red', '#12', null, undefined, '#zzzzzz']) assert.deepEqual(accentVars(bad, 'dark'), {}, String(bad))
})

test('the accents look different from each other', () => {
  const fills = ACCENTS.map(a => accentVars(a.hex, 'dark')['--brand'])
  assert.equal(new Set(fills).size, ACCENTS.length)
})
