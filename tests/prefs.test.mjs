// Preferences: what is accepted, what each choice does to the page, how the copies
// on the device and in the account are reconciled, and that the script that applies
// them before the app starts does exactly what the app does afterwards.
//
//   node --test tests/prefs.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {
  ACCENTS, CONTRASTS, DEFAULT_PREFS, DENSITIES, FONTS, GROUP_MINUTES, PALETTES, SEND_KEYS, TEXT_SIZES,
  THEMES, TIME_FORMATS, applySnapshot, computeSnapshot, isDefault, newerPrefs, normalizePrefs, resolveLight,
} from '../src/lib/prefs.js'
import { createPrefsStore, PREFS_KEY, SNAPSHOT_KEY } from '../src/lib/prefsStore.js'

// ---------- stand-ins for the browser ----------

function fakeRoot() {
  const classes = new Set()
  const style = new Map()
  return {
    classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); return on }, add: (c) => classes.add(c), contains: (c) => classes.has(c) },
    style: { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k), get: (k) => style.get(k), all: () => Object.fromEntries(style) },
    dataset: {},
    classes,
  }
}
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => m.delete(k), raw: (k) => m.get(k) }
}
function fakeMedia(light = false) {
  const handlers = new Set()
  const mq = { matches: light, addEventListener: (_, fn) => handlers.add(fn), set(v) { mq.matches = v; handlers.forEach(h => h()) } }
  return mq
}
function makeStore({ initial = {}, light = false, now = (() => { let t = 1000; return () => ++t })() } = {}) {
  const storage = fakeStorage(initial)
  const root = fakeRoot()
  const media = fakeMedia(light)
  const fonts = []
  const store = createPrefsStore({ storage, root, matchMedia: () => media, now, loadFont: (u) => fonts.push(u) })
  return { store, storage, root, media, fonts }
}

// ---------- the options on offer ----------

test('the options: three themes, eight backgrounds, nine accents, four sizes, two densities, three fonts', () => {
  assert.deepEqual(THEMES.map(t => t.id), ['auto', 'light', 'dark'])
  assert.equal(PALETTES.length, 8)
  assert.equal(ACCENTS.length, 9)
  assert.deepEqual(TEXT_SIZES.map(t => t.id), ['small', 'default', 'large', 'xlarge'])
  assert.deepEqual(DENSITIES.map(t => t.id), ['comfortable', 'compact'])
  assert.deepEqual(FONTS.map(t => t.id), ['inter', 'system', 'readable'])
  assert.deepEqual(CONTRASTS.map(t => t.id), ['normal', 'high'])
  assert.deepEqual(TIME_FORMATS.map(t => t.id), ['auto', '12h', '24h'])
  assert.deepEqual(SEND_KEYS.map(t => t.id), ['enter', 'mod-enter'])
  assert.deepEqual(GROUP_MINUTES.map(t => t.id), [0, 2, 5, 15])
})

test('the defaults are what the app has always been', () => {
  assert.equal(DEFAULT_PREFS.theme, 'dark')
  assert.equal(DEFAULT_PREFS.background, 'slate')
  assert.equal(DEFAULT_PREFS.accent, null)
  assert.equal(DEFAULT_PREFS.groupMinutes, 5, 'messages by one person 5 minutes apart were already grouped')
  assert.equal(DEFAULT_PREFS.sendKey, 'enter')
  assert.equal(DEFAULT_PREFS.tabTitleCount, true)
})

// ---------- accepting values ----------

test('nothing, or nonsense, gives the defaults', () => {
  for (const raw of [undefined, null, 5, 'x', [], [1, 2], true, () => 1]) {
    assert.deepEqual(normalizePrefs(raw), DEFAULT_PREFS, String(raw))
  }
})

test('a valid set is kept as it is', () => {
  const p = {
    theme: 'light', background: 'ocean', accent: '#e8552b', textSize: 'large', density: 'compact', font: 'readable',
    contrast: 'high', reduceMotion: true, timeFormat: '24h', sendKey: 'mod-enter', groupMinutes: 15, tabTitleCount: false, updatedAt: 1234,
  }
  assert.deepEqual(normalizePrefs(p), p)
})

test('each field falls back on its own when its value is not on the list', () => {
  const n = normalizePrefs({
    theme: 'sepia', background: 'neon', accent: 'red', textSize: 'huge', density: 'tight', font: 'comic',
    contrast: 'max', reduceMotion: 'yes', timeFormat: '48h', sendKey: 'tab', groupMinutes: 7, tabTitleCount: 'no', updatedAt: -3,
  })
  assert.deepEqual(n, DEFAULT_PREFS)
  assert.equal(normalizePrefs({ theme: 'light', background: 'neon' }).theme, 'light', 'a bad field does not discard a good one')
})

test('accents are stored as six lowercase digits; the original blue is stored as "none"', () => {
  assert.equal(normalizePrefs({ accent: '#E8552B' }).accent, '#e8552b')
  assert.equal(normalizePrefs({ accent: 'e8552b' }).accent, '#e8552b')
  assert.equal(normalizePrefs({ accent: '#f80' }).accent, '#ff8800')
  assert.equal(normalizePrefs({ accent: '#5865f2' }).accent, null)
  assert.equal(normalizePrefs({ accent: '#5865F2' }).accent, null)
  assert.equal(normalizePrefs({ accent: '#zzzzzz' }).accent, null)
  assert.equal(normalizePrefs({ accent: 12345 }).accent, null)
})

test('only real booleans count for the two switches; numbers must be real and positive', () => {
  assert.equal(normalizePrefs({ reduceMotion: 1 }).reduceMotion, false)
  assert.equal(normalizePrefs({ reduceMotion: true }).reduceMotion, true)
  assert.equal(normalizePrefs({ tabTitleCount: 0 }).tabTitleCount, true, 'not a boolean: the default')
  assert.equal(normalizePrefs({ tabTitleCount: false }).tabTitleCount, false)
  assert.equal(normalizePrefs({ updatedAt: NaN }).updatedAt, 0)
  assert.equal(normalizePrefs({ updatedAt: Infinity }).updatedAt, 0)
  assert.equal(normalizePrefs({ updatedAt: '5' }).updatedAt, 0)
  assert.equal(normalizePrefs({ updatedAt: 12.9 }).updatedAt, 12)
})

test('unknown fields are dropped (an account copy from newer code cannot smuggle anything in)', () => {
  const n = normalizePrefs({ theme: 'light', evil: '<script>', __proto__: { x: 1 }, constructor: 'x' })
  assert.deepEqual(Object.keys(n).sort(), Object.keys(DEFAULT_PREFS).sort())
})

test('isDefault ignores when it was last changed', () => {
  assert.equal(isDefault(DEFAULT_PREFS), true)
  assert.equal(isDefault({ updatedAt: 999 }), true)
  assert.equal(isDefault({ density: 'compact' }), false)
  assert.equal(isDefault({ accent: '#e8552b' }), false)
})

// ---------- two copies: this device and the account ----------

test('the copy changed last wins; a tie keeps the local one', () => {
  const local = normalizePrefs({ theme: 'light', updatedAt: 100 })
  assert.equal(newerPrefs(local, { theme: 'dark', updatedAt: 200 }).from, 'remote')
  assert.equal(newerPrefs(local, { theme: 'dark', updatedAt: 200 }).prefs.theme, 'dark')
  assert.equal(newerPrefs(local, { theme: 'dark', updatedAt: 50 }).from, 'local')
  assert.equal(newerPrefs(local, { theme: 'dark', updatedAt: 100 }).from, 'local', 'a tie')
  assert.equal(newerPrefs(local, undefined).from, 'local')
  assert.equal(newerPrefs(local, null).from, 'local')
  assert.equal(newerPrefs(local, 'junk').from, 'local')
})

test('an account copy is sanitised before it can win', () => {
  const local = normalizePrefs({ updatedAt: 1 })
  const r = newerPrefs(local, { theme: 'neon', accent: 'javascript:alert(1)', updatedAt: 500 })
  assert.equal(r.from, 'remote')
  assert.equal(r.prefs.theme, 'dark')
  assert.equal(r.prefs.accent, null)
})

// ---------- what a choice does to the page ----------

test('the defaults change nothing on the page', () => {
  const snap = computeSnapshot(DEFAULT_PREFS)
  assert.deepEqual(snap.vars, { dark: {}, light: {} })
  assert.equal(snap.fontSize, null)
  assert.equal(snap.fontStack, null)
  assert.equal(snap.density, null)
  assert.equal(snap.motion, null)
  const root = fakeRoot()
  applySnapshot(snap, root)
  assert.deepEqual(root.style.all(), {})
  assert.deepEqual(root.dataset, {})
  assert.equal(root.classes.size, 0)
})

test('a background, an accent and higher contrast each add their own variables, for both themes', () => {
  const bg = computeSnapshot({ background: 'forest' })
  assert.ok('--bg-main' in bg.vars.dark && '--bg-main' in bg.vars.light)
  assert.ok(!('--brand' in bg.vars.dark))
  const ac = computeSnapshot({ accent: '#e8552b' })
  assert.deepEqual(Object.keys(ac.vars.dark).sort(), ['--brand', '--brand-hover', '--brand-text'])
  assert.notDeepEqual(ac.vars.dark, ac.vars.light, 'the accent is adjusted per theme')
  const hc = computeSnapshot({ contrast: 'high' })
  assert.ok('--ink-dim' in hc.vars.dark && '--line-subtle' in hc.vars.light)
})

test('text size, spacing, motion and font become plain settings', () => {
  const snap = computeSnapshot({ textSize: 'large', density: 'compact', reduceMotion: true, font: 'system' })
  assert.equal(snap.fontSize, '112.5%')
  assert.equal(snap.density, 'compact')
  assert.equal(snap.motion, 'reduced')
  assert.match(snap.fontStack, /system-ui/)
  assert.equal(computeSnapshot({ textSize: 'small' }).fontSize, '87.5%')
  assert.equal(computeSnapshot({ textSize: 'xlarge' }).fontSize, '125%')
  assert.equal(computeSnapshot({ textSize: 'default' }).fontSize, null)
})

test('applying puts the theme class, the variables and the settings on the page', () => {
  const root = fakeRoot()
  const light = applySnapshot(computeSnapshot({ theme: 'light', accent: '#e8552b', textSize: 'large', density: 'compact', reduceMotion: true, font: 'system' }), root)
  assert.equal(light, true)
  assert.equal(root.classes.has('light'), true)
  assert.ok(root.style.get('--brand'))
  assert.equal(root.style.get('font-size'), '112.5%')
  assert.match(root.style.get('--font-body'), /system-ui/)
  assert.equal(root.dataset.density, 'compact')
  assert.equal(root.dataset.motion, 'reduced')
})

test('"Auto" follows the device', () => {
  const snap = computeSnapshot({ theme: 'auto' })
  assert.equal(applySnapshot(snap, fakeRoot(), { systemLight: true }), true)
  assert.equal(applySnapshot(snap, fakeRoot(), { systemLight: false }), false)
  assert.equal(resolveLight('light', false), true)
  assert.equal(resolveLight('dark', true), false)
  assert.equal(resolveLight('auto', true), true)
})

test('the right theme\'s colours are used, and going back removes everything that was set', () => {
  const root = fakeRoot()
  const accent = computeSnapshot({ theme: 'auto', accent: '#e8552b', background: 'ocean' })
  applySnapshot(accent, root, { systemLight: false })
  const dark = root.style.get('--brand-text')
  const darkBg = root.style.get('--bg-main')
  applySnapshot(accent, root, { systemLight: true })
  // The fill is the same in both themes; the accent used as text, and the surfaces, are not.
  assert.notEqual(root.style.get('--brand-text'), dark, 'the light theme has its own accent text shade')
  assert.notEqual(root.style.get('--bg-main'), darkBg, 'and its own surfaces')
  applySnapshot(computeSnapshot(DEFAULT_PREFS), root)
  assert.deepEqual(root.style.all(), {}, 'nothing left behind')
  assert.deepEqual(root.dataset, {})
})

test('changing one choice does not disturb the others', () => {
  const root = fakeRoot()
  applySnapshot(computeSnapshot({ accent: '#e8552b', background: 'ocean' }), root)
  const bgBefore = root.style.get('--bg-main')
  applySnapshot(computeSnapshot({ accent: '#1fa855', background: 'ocean' }), root)
  assert.equal(root.style.get('--bg-main'), bgBefore)
  assert.notEqual(root.style.get('--brand'), undefined)
})

// ---------- the store ----------

test('with nothing saved it starts at the defaults and puts nothing on the page', () => {
  const { store, root } = makeStore()
  assert.deepEqual(store.get(), DEFAULT_PREFS)
  store.apply()
  assert.deepEqual(root.style.all(), {})
})

test('the old light/dark switch carries over once, and only when nothing newer is saved', () => {
  assert.equal(makeStore({ initial: { themeMode: 'light' } }).store.get().theme, 'light')
  assert.equal(makeStore({ initial: { themeMode: 'dark' } }).store.get().theme, 'dark')
  assert.equal(makeStore({ initial: { themeMode: 'light', [PREFS_KEY]: JSON.stringify({ theme: 'dark', updatedAt: 5 }) } }).store.get().theme, 'dark')
})

test('set changes the page at once, keeps it on the device, and stamps when', () => {
  const { store, root, storage } = makeStore()
  const state = store.set({ theme: 'light', accent: '#e8552b' })
  assert.equal(state.theme, 'light')
  assert.ok(state.updatedAt > 0)
  assert.equal(root.classes.has('light'), true)
  assert.ok(root.style.get('--brand'))
  assert.equal(JSON.parse(storage.raw(PREFS_KEY)).accent, '#e8552b')
})

test('a reload brings back what was chosen', () => {
  const a = makeStore()
  a.store.set({ density: 'compact', background: 'berry' })
  const b = makeStore({ initial: { [PREFS_KEY]: a.storage.raw(PREFS_KEY) } })
  assert.equal(b.store.get().density, 'compact')
  assert.equal(b.store.get().background, 'berry')
})

test('what is stored for the start-up script is exactly what the page applies', () => {
  const { store, storage } = makeStore()
  store.set({ theme: 'auto', accent: '#7c4ddb', background: 'grape', textSize: 'xlarge' })
  assert.deepEqual(JSON.parse(storage.raw(SNAPSHOT_KEY)), computeSnapshot(store.get()))
})

test('invalid choices are refused, not stored', () => {
  const { store } = makeStore()
  store.set({ theme: 'neon', background: 'plaid', accent: 'nope', textSize: 'giant' })
  assert.equal(store.get().theme, 'dark')
  assert.equal(store.get().background, 'slate')
  assert.equal(store.get().accent, null)
})

test('subscribers hear about changes, and stop after unsubscribing', () => {
  const { store } = makeStore()
  let n = 0
  const off = store.subscribe(() => n++)
  store.set({ density: 'compact' }); store.reset()
  assert.equal(n, 2)
  off(); store.set({ density: 'compact' })
  assert.equal(n, 2)
})

test('reset goes back to the defaults, clears the page, and counts as a change to send', () => {
  const { store, root } = makeStore()
  store.set({ accent: '#e8552b', theme: 'light' })
  const sent = []
  store.onLocalChange(p => sent.push(p))
  store.reset()
  assert.equal(isDefault(store.get()), true)
  assert.deepEqual(root.style.all(), {})
  assert.equal(root.classes.has('light'), false)
  assert.equal(sent.length, 1)
  assert.ok(sent[0].updatedAt > 0, 'newer than before, so it wins over the account copy')
})

test('changes made here are announced for the account; ones adopted from it are not (no echo)', () => {
  const { store } = makeStore()
  const sent = []
  store.onLocalChange(p => sent.push(p.theme))
  store.set({ theme: 'light' })
  assert.deepEqual(sent, ['light'])
  assert.equal(store.adoptRemote({ theme: 'dark', updatedAt: 9_999_999 }), true)
  assert.equal(store.get().theme, 'dark')
  assert.deepEqual(sent, ['light'], 'adopting is not a local change')
})

test('an older or equal account copy does not replace what this device has', () => {
  const { store } = makeStore()
  store.set({ theme: 'light' })
  const t = store.get().updatedAt
  assert.equal(store.adoptRemote({ theme: 'dark', updatedAt: t - 1 }), false)
  assert.equal(store.adoptRemote({ theme: 'dark', updatedAt: t }), false)
  assert.equal(store.adoptRemote(undefined), false)
  assert.equal(store.get().theme, 'light')
})

test('adopting applies to the page and is kept on the device', () => {
  const { store, root, storage } = makeStore()
  store.adoptRemote({ theme: 'light', accent: '#1fa855', updatedAt: 5000 })
  assert.equal(root.classes.has('light'), true)
  assert.ok(root.style.get('--brand'))
  assert.equal(JSON.parse(storage.raw(PREFS_KEY)).theme, 'light')
})

test('"Auto" re-applies when the device switches between light and dark', () => {
  const { store, root, media } = makeStore({ light: false })
  store.set({ theme: 'auto' })
  assert.equal(root.classes.has('light'), false)
  media.set(true)
  assert.equal(root.classes.has('light'), true)
  store.set({ theme: 'dark' })
  media.set(false); media.set(true)
  assert.equal(root.classes.has('light'), false, 'a fixed theme ignores the device')
})

test('the "Readable" font is fetched only when chosen, and once', () => {
  const { store, fonts } = makeStore()
  store.set({ density: 'compact' })
  assert.deepEqual(fonts, [])
  store.set({ font: 'readable' })
  store.set({ font: 'inter' }); store.set({ font: 'readable' })
  assert.equal(fonts.length, 1)
  assert.match(fonts[0], /Atkinson\+Hyperlegible/)
})

test('damaged saved preferences start from the defaults instead of breaking the app', () => {
  for (const raw of ['not json', '[1]', 'null', '"x"', '{"theme":"neon"}']) {
    assert.deepEqual(makeStore({ initial: { [PREFS_KEY]: raw } }).store.get(), DEFAULT_PREFS, raw)
  }
})

test('storage that throws (private mode, full) still lets the choices work for this visit', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('full') } }
  const root = fakeRoot()
  const store = createPrefsStore({ storage: broken, root, matchMedia: () => fakeMedia(), now: () => 5 })
  assert.doesNotThrow(() => store.set({ theme: 'light' }))
  assert.equal(root.classes.has('light'), true)
  assert.equal(store.get().theme, 'light')
})

test('with no storage and no page at all (a test, a worker) nothing throws', () => {
  const store = createPrefsStore({})
  assert.doesNotThrow(() => { store.apply(); store.set({ theme: 'light' }); store.reset(); store.adoptRemote({ updatedAt: 9e9 }) })
})

// ---------- the script that runs before the app ----------

// index.html applies the saved snapshot before the app starts, so the page opens in
// the right colours. It is separate code (nothing can be imported that early), so a
// test runs it for real and holds it to the same result as the app's own.
function inlineScript() {
  const html = fs.readFileSync('index.html', 'utf8')
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  return scripts.find(s => s.includes(SNAPSHOT_KEY))
}
function runInline(storageInit, { light = false } = {}) {
  const root = fakeRoot()
  const sandbox = {
    localStorage: fakeStorage(storageInit),
    document: { documentElement: root },
    window: { matchMedia: () => ({ matches: light }) },
  }
  vm.runInNewContext(inlineScript(), sandbox)
  return root
}

test('index.html has a script that reads the saved snapshot', () => {
  assert.ok(inlineScript(), 'no script in index.html mentions ' + SNAPSHOT_KEY)
})

const SAMPLES = [
  { theme: 'dark' },
  { theme: 'light', accent: '#e8552b', background: 'ocean' },
  { theme: 'auto', accent: '#7c4ddb', background: 'grape', textSize: 'xlarge', density: 'compact', reduceMotion: true, font: 'system' },
  { theme: 'auto', contrast: 'high', background: 'forest' },
  { theme: 'dark', textSize: 'small', font: 'readable', accent: '#d98e04' },
]

test('the start-up script and the app put exactly the same things on the page', () => {
  for (const prefs of SAMPLES) {
    for (const systemLight of [false, true]) {
      const normalized = normalizePrefs(prefs)
      const snap = computeSnapshot(normalized)
      const viaApp = fakeRoot()
      applySnapshot(snap, viaApp, { systemLight })
      const viaScript = runInline({ [SNAPSHOT_KEY]: JSON.stringify(snap) }, { light: systemLight })
      const label = JSON.stringify(prefs) + ' systemLight=' + systemLight
      assert.deepEqual(viaScript.style.all(), viaApp.style.all(), 'variables: ' + label)
      assert.deepEqual([...viaScript.classes], [...viaApp.classes], 'classes: ' + label)
      assert.deepEqual(viaScript.dataset, viaApp.dataset, 'attributes: ' + label)
    }
  }
})

test('with no snapshot the start-up script falls back to the old light/dark switch', () => {
  assert.equal(runInline({ themeMode: 'light' }).classes.has('light'), true)
  assert.equal(runInline({ themeMode: 'dark' }).classes.has('light'), false)
  assert.equal(runInline({}).classes.has('light'), false)
})

test('a damaged snapshot cannot stop the page from starting', () => {
  for (const raw of ['not json', '{}', '[]', 'null', '{"theme":"light"}', '{"vars":5}']) {
    assert.doesNotThrow(() => runInline({ [SNAPSHOT_KEY]: raw, themeMode: 'light' }), raw)
  }
})

// ---------- different accounts on one browser, and the account copy's status ----------

test('resetLocal (another person signed in) goes to the defaults, applies, and sends nothing to any account', () => {
  const { store, root } = makeStore()
  store.set({ accent: '#e8552b', theme: 'light' })
  const sent = []
  store.onLocalChange(p => sent.push(p))
  store.resetLocal()
  assert.equal(isDefault(store.get()), true)
  assert.equal(store.get().updatedAt, 0, 'so any account copy is newer and wins')
  assert.deepEqual(root.style.all(), {})
  assert.equal(root.classes.has('light'), false)
  assert.deepEqual(sent, [])
  assert.equal(store.adoptRemote({ theme: 'light', updatedAt: 1 }), true, 'the new person\'s own copy is adopted')
})

test('the status of the account copy is announced when it changes, and only then', () => {
  const { store } = makeStore()
  const seen = []
  const off = store.subscribeSync(() => seen.push(store.getSyncStatus()))
  assert.equal(store.getSyncStatus(), 'idle')
  store.setSyncStatus('saving'); store.setSyncStatus('saving'); store.setSyncStatus('saved'); store.setSyncStatus('error')
  assert.deepEqual(seen, ['saving', 'saved', 'error'])
  off(); store.setSyncStatus('idle')
  assert.deepEqual(seen, ['saving', 'saved', 'error'])
});

test('going back to the default text size removes the size, it does not leave the last one behind', () => {
  const root = fakeRoot()
  applySnapshot(computeSnapshot({ textSize: 'xlarge' }), root)
  assert.equal(root.style.get('font-size'), '125%')
  applySnapshot(computeSnapshot({ textSize: 'default' }), root)
  assert.equal(root.style.get('font-size'), undefined)
  applySnapshot(computeSnapshot({ font: 'system', density: 'compact', reduceMotion: true }), root)
  applySnapshot(computeSnapshot({}), root)
  assert.deepEqual(root.style.all(), {})
  assert.deepEqual(root.dataset, {}, 'spacing and motion attributes are removed too')
})
