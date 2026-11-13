// The role summary at the foot of the admin page says only that developers have dev
// tools, and does not describe what the developer role can see or grant.
//
//   node --test tests/admin-hierarchy.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync('src/views/AdminPanel.jsx', 'utf8').replace(/\r\n/g, '\n')
// The words a reader sees: the paragraph that starts "Hierarchy:", up to its closing tag.
const start = src.indexOf('<strong className="text-ink-muted">Hierarchy:</strong>')
const paragraph = src.slice(start, src.indexOf('</p>', start)).replace(/\s+/g, ' ')

test('the hierarchy paragraph is there and says developers have dev tools', () => {
  assert.ok(start > 0, 'the Hierarchy paragraph exists')
  assert.ok(paragraph.includes('Developers have dev tools.'))
})

test('it does not describe what the developer role can see, hide or grant', () => {
  for (const leak of [
    'hold everything a super admin',
    'invisible to super admins',
    'groups a developer owns',
    'grant or revoke',
    'developer role',
    'one thing more',
  ]) assert.ok(!paragraph.includes(leak), `must not say: ${leak}`)
})

test('it does not say that anyone can read, watch or oversee other people\'s channels or groups', () => {
  for (const leak of [
    'without joining',
    'invisibly',
    'read every',
    'every other channel',
    'member list',
    'stay out of',
    'oversee',
    'oversight',
    'overseeing',
    'unseen',
    'secretly',
  ]) assert.ok(!paragraph.toLowerCase().includes(leak), `must not say: ${leak}`)
})

test('the rest of the summary is still there', () => {
  for (const kept of ['Super admins manage the workspace and other admins.', 'Admins can pin in any channel', 'Employees join groups by invitation', 'Guests are invited to individual channels']) {
    assert.ok(paragraph.replace(/\s+/g, ' ').includes(kept.replace(/\s+/g, ' ')), `still says: ${kept}`)
  }
})

test('developers are named once in it, and nowhere else in that paragraph', () => {
  assert.equal((paragraph.match(/[Dd]eveloper/g) || []).length, 1)
})
