// The company apps under the toolbox icon: that the list is sound, that only plain
// https links can be opened, and that a bad entry is left out instead of breaking the menu.
//
//   node --test tests/apps.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { APPS_VISIBLE_TO, APP_ICONS, WORKSPACE_APPS, canSeeApps, isSafeAppUrl, usableApps } from '../src/lib/apps.js'

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
    assert.ok(isSafeAppUrl(a.url), a.id + ' url')
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
