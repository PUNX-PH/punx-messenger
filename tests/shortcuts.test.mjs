// The keyboard shortcuts sheet: that it lists only real shortcuts, in this person's own
// words and keys, and when "?" opens it.
//
//   node --test tests/shortcuts.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { OPEN_SHORTCUTS_EVENT, isMacPlatform, keyLabels, shortcutGroups, shouldOpenHelp } from '../src/lib/shortcuts.js'
import { unreadKeyDirection } from '../src/lib/quickSwitch.js'
import { shouldSend } from '../src/lib/sendKey.js'
import { shouldEditLast } from '../src/lib/editLast.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (f) => lf(fs.readFileSync(f, 'utf8'))
const items = (opts) => shortcutGroups(opts).flatMap((g) => g.items)
const byId = (opts) => Object.fromEntries(items(opts).map((i) => [i.id, i]))

// ---------- what it lists ----------

test('it lists exactly the shortcuts that exist, and not one that does not', () => {
  assert.deepEqual(
    items().map((i) => i.id),
    ['switcher', 'next-unread', 'prev-unread', 'send', 'newline', 'edit-last', 'mention-move', 'mention-pick', 'close', 'help'],
  )
})

test('every entry has keys and a plain sentence, ids are unique, and the groups have titles', () => {
  const all = items()
  assert.equal(new Set(all.map((i) => i.id)).size, all.length)
  for (const i of all) {
    assert.ok(Array.isArray(i.keys) && i.keys.length > 0 && i.keys.every((k) => typeof k === 'string' && k), i.id)
    assert.ok(i.does.length > 5 && i.does.length < 70, i.id)
    if (i.or) assert.ok(Array.isArray(i.or) && i.or.length > 0, i.id + ' or')
  }
  for (const g of shortcutGroups()) assert.ok(g.title && g.items.length > 0)
})

// ---------- each one is pinned to the code that does it ----------

test('Ctrl/Cmd+K really opens the quick switcher', () => {
  const host = read('src/components/QuickSwitcherHost.jsx')
  assert.ok(host.includes("(e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'"))
  assert.deepEqual(byId().switcher.keys, ['mod', 'K'])
})

test('Alt+Shift+Down and Up really go to the next and the newest unread', () => {
  const at = (key) => unreadKeyDirection({ altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, key })
  assert.equal(at('ArrowDown'), 'down')
  assert.equal(at('ArrowUp'), 'up')
  assert.deepEqual(byId()['next-unread'].keys, ['Alt', 'Shift', '↓'])
  assert.deepEqual(byId()['prev-unread'].keys, ['Alt', 'Shift', '↑'])
  assert.match(byId()['next-unread'].does, /waiting longest/)
  assert.match(byId()['prev-unread'].does, /newest/)
})

test('with the default setting, Enter sends and Shift+Enter is a new line', () => {
  const press = (over) => shouldSend({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, ...over }, 'enter')
  assert.equal(press({}), true)
  assert.equal(press({ shiftKey: true }), false)
  const g = byId({ sendKey: 'enter' })
  assert.deepEqual(g.send.keys, ['Enter'])
  assert.deepEqual(g.newline.keys, ['Shift', 'Enter'])
})

test('with "Ctrl+Enter to send", that sends and a plain Enter is a new line', () => {
  const press = (over) => shouldSend({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, ...over }, 'mod-enter')
  assert.equal(press({ ctrlKey: true }), true)
  assert.equal(press({ metaKey: true }), true)
  assert.equal(press({}), false)
  const g = byId({ sendKey: 'mod-enter' })
  assert.deepEqual(g.send.keys, ['mod', 'Enter'])
  assert.deepEqual(g.newline.keys, ['Enter'])
})

test('the up arrow in an empty box really edits your last message', () => {
  const up = { key: 'ArrowUp', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }
  assert.equal(shouldEditLast(up, { text: '' }), true)
  assert.deepEqual(byId()['edit-last'].keys, ['↑'])
  assert.match(byId()['edit-last'].does, /empty/)
  assert.ok(read('src/components/Composer.jsx').includes('shouldEditLast(e,'))
})

test('the sending lines follow the person\'s setting, and the default is Enter', () => {
  assert.deepEqual(byId().send.keys, ['Enter'])
  assert.deepEqual(byId({ sendKey: 'nonsense' }).send.keys, ['Enter'])
  assert.notDeepEqual(byId({ sendKey: 'mod-enter' }).send.keys, byId({ sendKey: 'enter' }).send.keys)
})

test('the arrows, Enter, Tab and Esc really work in the @ list', () => {
  const composer = read('src/components/Composer.jsx')
  for (const key of ["e.key === 'ArrowDown'", "e.key === 'ArrowUp'", "e.key === 'Enter' || e.key === 'Tab'", "e.key === 'Escape'"]) {
    assert.ok(composer.includes(key), key)
  }
  const mm = byId()
  assert.deepEqual([mm['mention-move'].keys, mm['mention-move'].or], [['↑'], ['↓']])
  assert.deepEqual([mm['mention-pick'].keys, mm['mention-pick'].or], [['Enter'], ['Tab']])
})

test('Esc really closes the shared dialogs', () => {
  assert.ok(read('src/components/Modal.jsx').includes("e.key === 'Escape'"))
  assert.deepEqual(byId().close.keys, ['Esc'])
})

// ---------- how keys are written ----------

test('Cmd on a Mac, Ctrl elsewhere, and Option on a Mac', () => {
  assert.deepEqual(keyLabels(['mod', 'K'], true), ['⌘', 'K'])
  assert.deepEqual(keyLabels(['mod', 'K'], false), ['Ctrl', 'K'])
  assert.deepEqual(keyLabels(['Alt', 'Shift', '↓'], true), ['⌥', 'Shift', '↓'])
  assert.deepEqual(keyLabels(['Alt', 'Shift', '↓'], false), ['Alt', 'Shift', '↓'])
  assert.deepEqual(keyLabels(undefined, true), [])
})

test('which platforms count as a Mac', () => {
  for (const p of ['MacIntel', 'macOS', 'iPhone', 'iPad', 'MacARM']) assert.equal(isMacPlatform(p), true, p)
  for (const p of ['Win32', 'Windows', 'Linux x86_64', 'Android', '', undefined, null]) assert.equal(isMacPlatform(p), false, String(p))
})

// ---------- when "?" opens it ----------

const key = (over = {}) => ({ key: '?', ctrlKey: false, metaKey: false, altKey: false, isComposing: false, target: { tagName: 'BODY' }, ...over })

test('"?" opens it when you are not typing, with or without Shift', () => {
  assert.equal(shouldOpenHelp(key()), true)
  assert.equal(shouldOpenHelp(key({ shiftKey: true })), true)
  assert.equal(shouldOpenHelp(key({ target: { tagName: 'DIV' } })), true)
  assert.equal(shouldOpenHelp(key({ target: { tagName: 'BUTTON' } })), true)
})

test('not while typing in a text box, a text area, a menu or an editable area', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea']) assert.equal(shouldOpenHelp(key({ target: { tagName } })), false, tagName)
  assert.equal(shouldOpenHelp(key({ target: { tagName: 'DIV', isContentEditable: true } })), false)
})

test('not for any other key, nor with Ctrl, Cmd or Alt, nor while an input method composes', () => {
  for (const k of ['/', 'a', 'Escape', 'Enter', '', undefined]) assert.equal(shouldOpenHelp(key({ key: k })), false, String(k))
  assert.equal(shouldOpenHelp(key({ ctrlKey: true })), false)
  assert.equal(shouldOpenHelp(key({ metaKey: true })), false)
  assert.equal(shouldOpenHelp(key({ altKey: true })), false)
  assert.equal(shouldOpenHelp(key({ isComposing: true })), false)
})

test('a missing or empty event does nothing', () => {
  for (const e of [undefined, null, {}]) assert.equal(shouldOpenHelp(e), false)
  assert.equal(shouldOpenHelp(key({ target: undefined })), true, 'a key with no target is not in a text field')
})

// ---------- the wiring ----------

test('the host listens on the window, toggles, and opens on the preferences\' request', () => {
  const host = read('src/components/ShortcutsHelpHost.jsx')
  assert.ok(host.includes("window.addEventListener('keydown', onKey)"))
  assert.ok(host.includes('if (!shouldOpenHelp(e)) return\n      e.preventDefault()\n      setOpen(o => !o)'), 'the key toggles it and the browser does not also act on it')
  assert.ok(host.includes('window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen)'))
  assert.ok(host.includes('window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen)') && host.includes("window.removeEventListener('keydown', onKey)"), 'and cleans up after itself')
  assert.ok(host.includes('<LazySlot overlay'), 'a failure to load it does not reach the app\'s error screen')
  assert.equal(OPEN_SHORTCUTS_EVENT, 'punx:shortcuts')
})

test('it is mounted for signed-in people, and loaded on demand', () => {
  const app = read('src/App.jsx')
  assert.ok(app.includes("import ShortcutsHelpHost from './components/ShortcutsHelpHost'"))
  assert.ok(app.includes('{user && profile && <ShortcutsHelpHost />}'))
  const lazy = read('src/lib/lazyParts.js')
  assert.ok(lazy.includes("export const ShortcutsHelp = lazyWithPreload(() => import('../components/ShortcutsHelp'))"))
  assert.ok(!/preloadCommon = .*ShortcutsHelp/.test(lazy), 'it is not downloaded in the background for people who never press ?')
})

test('the sheet uses the person\'s own send setting and the shared dialog', () => {
  const sheet = read('src/components/ShortcutsHelp.jsx')
  assert.ok(sheet.includes('const [{ sendKey }] = usePrefs()'))
  assert.ok(sheet.includes('shortcutGroups({ sendKey })'))
  assert.ok(sheet.includes("import Modal from './Modal'"))
  assert.ok(sheet.includes('role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"'))
  assert.ok(sheet.includes('aria-label="Close"'))
})

test('preferences link to it, and close first so the two dialogs do not stack', () => {
  const prefs = read('src/components/PreferencesModal.jsx')
  assert.ok(prefs.includes("import { OPEN_SHORTCUTS_EVENT } from '../lib/shortcuts'"))
  assert.ok(prefs.includes('onClick={() => { onClose?.(); window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)) }}'))
  assert.ok(prefs.includes('See all keyboard shortcuts'))
  // It sits in the "Send a message with" section, next to the setting it depends on.
  assert.ok(prefs.indexOf('See all keyboard shortcuts') > prefs.indexOf('Send a message with'))
  assert.ok(prefs.indexOf('See all keyboard shortcuts') < prefs.indexOf('>Alerts<'))
})
