// The company apps under the toolbox icon: that the list is sound, that only plain
// https links can be opened, and that a bad entry is left out instead of breaking the menu.
//
//   node --test tests/apps.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { APPS_VISIBLE_TO, APP_ACTIONS, APP_ICONS, WORKSPACE_APPS, canSeeApps, isSafeAppUrl, usableApps } from '../src/lib/apps.js'
import { OPEN_CALENDAR_EVENT } from '../src/lib/dtrCalendar.js'

test('the DTR tracker is on the list and goes to its own site', () => {
  const dtr = WORKSPACE_APPS.find(a => a.id === 'dtr')
  assert.ok(dtr)
  assert.equal(dtr.name, 'DTR tracker')
  assert.equal(dtr.url, 'https://dtr.punxai.online/')
})

test('every app on the list is complete, unique and openable', () => {
  const ids = WORKSPACE_APPS.map(a => a.id)
  assert.equal(new Set(ids).size, ids.length, 'ids are unique')
  for (const a of WORKSPACE_APPS) {
    assert.match(a.id, /^[a-z0-9-]+$/, a.id)
    assert.ok(a.name.trim().length > 0, a.id + ' name')
    // A link or an action: exactly one.
    assert.equal((a.url !== undefined) + (a.action !== undefined), 1, a.id + ' has a url or an action, not both')
    if (a.url !== undefined) assert.ok(isSafeAppUrl(a.url), a.id + ' url')
    if (a.action !== undefined) assert.ok(Object.hasOwn(APP_ACTIONS, a.action), a.id + ' action')
    assert.ok(APP_ICONS.includes(a.icon), a.id + ' icon ' + a.icon)
  }
  assert.equal(usableApps().length, WORKSPACE_APPS.length, 'nothing on the real list is dropped')
})

test('only a plain https link is safe to open', () => {
  assert.equal(isSafeAppUrl('https://dtr.punxai.online/'), true)
  assert.equal(isSafeAppUrl('https://example.com/path?x=1#y'), true)
  for (const bad of [
    'http://dtr.punxai.online/', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/x',
    '//dtr.punxai.online/', '/relative', 'dtr.punxai.online', 'https://user:pw@example.com/', 'https://localhost/',
    'https://', '', '   ', null, undefined, 42, {}, ['https://example.com'],
  ]) assert.equal(isSafeAppUrl(bad), false, String(bad))
})

test('a malformed entry is left out and the rest still show', () => {
  const good = { id: 'a', name: 'A', url: 'https://a.example.com/' }
  const list = [
    good, null, {}, { id: 'b', name: 'B', url: 'javascript:alert(1)' }, { id: 'c', name: '  ', url: 'https://c.example.com/' },
    { id: '', name: 'D', url: 'https://d.example.com/' }, { id: 'a', name: 'Dup', url: 'https://dup.example.com/' },
    { id: 'e', name: 'E', url: 'https://e.example.com/' },
  ]
  assert.deepEqual(usableApps(list).map(a => a.id), ['a', 'e'])
  assert.deepEqual(usableApps([]), [])
})

test('for now only developers get the toolbox', () => {
  assert.deepEqual(APPS_VISIBLE_TO, ['developer'])
  assert.equal(canSeeApps({ role: 'developer' }), true)
  for (const role of ['super_admin', 'admin', 'employee', 'guest', undefined, null, '', 'Developer', 'developer ']) {
    assert.equal(canSeeApps({ role }), false, String(role))
  }
  assert.equal(canSeeApps({}), false, 'no role reads as an employee')
  assert.equal(canSeeApps(null), false)
  assert.equal(canSeeApps(undefined), false, 'before the profile has loaded')
})

test('the role it checks is the one the app calls a developer', () => {
  assert.ok(fs.readFileSync('src/lib/auth.jsx', 'utf8').includes("isDeveloper = (p) => p?.role === 'developer'"))
})

test('the menu draws nothing unless the person may see it', () => {
  const menu = fs.readFileSync('src/components/AppsMenu.jsx', 'utf8')
  assert.ok(menu.includes('if (!canSeeApps(profile)'))
  assert.ok(menu.includes('apps.length === 0'), 'and no empty button when there is nothing to open')
})

test('the header carries the toolbox, and the menu opens links safely in a new tab', () => {
  const header = fs.readFileSync('src/components/ChatSurface.jsx', 'utf8')
  assert.match(header, /import AppsMenu from '\.\/AppsMenu'/)
  assert.match(header, /<AppsMenu \/>/)
  const menu = fs.readFileSync('src/components/AppsMenu.jsx', 'utf8')
  assert.match(menu, /target="_blank"/)
  assert.match(menu, /rel="noopener noreferrer"/, 'a new tab must not get a handle back to the messenger')
  assert.match(menu, /usableApps\(\)/, 'only vetted links are rendered')
})

test('the menu is a grid of tiles, each with its name and a full description on hover', () => {
  const menu = fs.readFileSync('src/components/AppsMenu.jsx', 'utf8')
  assert.ok(menu.includes('grid grid-cols-3'), 'tiles in a grid')
  assert.ok(menu.includes('flex-col'), 'icon above the name')
  assert.ok(menu.includes('const title = a.description ?'), 'the one-line description is still reachable')
  assert.ok(menu.includes('overflow-y-auto'), 'many apps scroll instead of running off the screen')
})

test('the calendar is a toolbox entry that opens the widget instead of a link', () => {
  const cal = WORKSPACE_APPS.find(a => a.id === 'calendar')
  assert.ok(cal)
  assert.equal(cal.action, 'calendar')
  assert.equal(cal.url, undefined)
  assert.equal(APP_ACTIONS.calendar, OPEN_CALENDAR_EVENT)
  assert.equal(OPEN_CALENDAR_EVENT, 'punx:calendar')
  assert.ok(usableApps().some(a => a.id === 'calendar'))
})

test('an entry is a link or an action, never both and never neither, and an unknown action is out', () => {
  const link = { id: 'a', name: 'A', url: 'https://a.example.com/' }
  const act = { id: 'b', name: 'B', action: 'calendar' }
  assert.deepEqual(usableApps([link, act]).map(a => a.id), ['a', 'b'])
  assert.deepEqual(usableApps([{ id: 'c', name: 'C', url: 'https://c.example.com/', action: 'calendar' }]), [], 'both')
  assert.deepEqual(usableApps([{ id: 'd', name: 'D' }]), [], 'neither')
  assert.deepEqual(usableApps([{ id: 'e', name: 'E', action: 'launch-missiles' }]), [], 'an action nothing handles')
  assert.deepEqual(usableApps([{ id: 'f', name: 'F', action: 'toString' }]), [], 'an inherited name is not an action')
  assert.deepEqual(usableApps([{ id: 'g', name: 'G', action: '' }]), [], 'empty')
  assert.deepEqual(usableApps([{ id: 'h', name: 'H', url: 'javascript:alert(1)', action: undefined }]), [])
})

test('the menu sends the action\'s event from a button, and still opens links safely', () => {
  const menu = fs.readFileSync('src/components/AppsMenu.jsx', 'utf8')
  assert.ok(menu.includes('window.dispatchEvent(new Event(APP_ACTIONS[a.action]))'))
  assert.ok(menu.includes('type="button" role="menuitem"'), 'an action is a button, not a link to nowhere')
  assert.ok(menu.includes('rel="noopener noreferrer"'))
})
