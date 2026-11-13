// A custom status next to your name: how it is cleaned, when it expires, what is shown when
// someone else's profile holds something odd, and where it appears.
//
//   node --test tests/status.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  EXPIRY_OPTIONS, STATUS_MAX, STATUS_PRESETS, buildStatus, cleanStatusText, expiryAt, statusOf,
} from '../src/lib/status.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (f) => lf(fs.readFileSync(f, 'utf8'))
const HOUR = 3600000
const NOW = new Date(2026, 10, 13, 14, 30, 0).getTime() // 13 Nov 2026, 14:30 local

// ---------- the text ----------

test('the text is one tidy line, trimmed', () => {
  assert.equal(cleanStatusText('  On   leave  '), 'On leave')
  assert.equal(cleanStatusText('In a\nmeeting\t until 3'), 'In a meeting until 3')
  assert.equal(cleanStatusText('Back\r\nsoon'), 'Back soon')
})

test('anything that is not text, or leaves nothing, is nothing', () => {
  for (const bad of [undefined, null, 5, {}, [], true, '', '   ', '\n\t', '\u0000\u0001']) assert.equal(cleanStatusText(bad), '', String(JSON.stringify(bad)))
})

test('control characters are dropped (replaced by a space, then tidied)', () => {
  assert.equal(cleanStatusText('a\u0000b\u0007c\u007Fd'), 'a b c d')
  assert.equal(cleanStatusText('x\u0085y'), 'x y')
})

test('text-direction marks, which can make text run backwards or hide what is around it, are removed', () => {
  assert.equal(cleanStatusText('safe\u202Etxet\u202C'), 'safe txet')
  assert.equal(cleanStatusText('a\u2066b\u2069c'), 'a b c')
  assert.equal(cleanStatusText('a\u200Fb\u200Ec'), 'a b c')
})

test('it is cut at STATUS_MAX characters, counting an emoji as one, and never in the middle of one', () => {
  assert.equal(STATUS_MAX, 60)
  assert.equal(Array.from(cleanStatusText('x'.repeat(500))).length, 60)
  const emoji = cleanStatusText('😀'.repeat(200))
  assert.equal(Array.from(emoji).length, 60)
  assert.ok(Array.from(emoji).every((c) => c === '😀'), 'whole emoji only')
  assert.equal(cleanStatusText('a'.repeat(59) + '😀😀'), 'a'.repeat(59) + '😀')
})

test('a cut that ends on a space does not leave one behind', () => {
  const s = 'a'.repeat(59) + ' bbbb'
  assert.equal(cleanStatusText(s), 'a'.repeat(59))
})

test('the presets are real statuses: short, clean, and different from each other', () => {
  assert.ok(STATUS_PRESETS.length >= 3)
  assert.equal(new Set(STATUS_PRESETS).size, STATUS_PRESETS.length)
  for (const p of STATUS_PRESETS) assert.equal(cleanStatusText(p), p, p)
})

// ---------- how long it stays ----------

test('hours and days are counted from now', () => {
  assert.equal(expiryAt('1h', NOW), NOW + HOUR)
  assert.equal(expiryAt('4h', NOW), NOW + 4 * HOUR)
  assert.equal(expiryAt('7d', NOW), NOW + 7 * 24 * HOUR)
})

test('"today" is the end of the person\'s own day, whatever the time now', () => {
  for (const at of [new Date(2026, 10, 13, 0, 0, 0), new Date(2026, 10, 13, 14, 30), new Date(2026, 10, 13, 23, 59, 59, 500)]) {
    const until = expiryAt('today', at.getTime())
    const end = new Date(until)
    assert.equal(end.getFullYear() * 10000 + end.getMonth() * 100 + end.getDate(), at.getFullYear() * 10000 + at.getMonth() * 100 + at.getDate(), 'the same calendar day')
    assert.deepEqual([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()], [23, 59, 59, 999])
    assert.ok(until > at.getTime())
  }
})

test('"never", and anything unknown, has no end', () => {
  for (const id of ['never', 'forever', '', undefined, null, 5, '1H']) assert.equal(expiryAt(id, NOW), null, String(id))
})

test('the choices offered are exactly the ones that mean something', () => {
  assert.deepEqual(EXPIRY_OPTIONS.map((o) => o.id), ['today', '1h', '4h', '7d', 'never'])
  for (const o of EXPIRY_OPTIONS) assert.ok(o.label.length > 2)
  assert.equal(EXPIRY_OPTIONS[0].id, 'today', 'a new status clears by itself unless you say otherwise')
})

// ---------- what is stored ----------

test('what is stored is the clean text and an end time, or nothing at all', () => {
  assert.deepEqual(buildStatus('  On   leave ', '1h', NOW), { text: 'On leave', until: NOW + HOUR })
  assert.deepEqual(buildStatus('Out sick', 'never', NOW), { text: 'Out sick', until: null })
  assert.equal(buildStatus('', 'today', NOW), null)
  assert.equal(buildStatus('   ', 'today', NOW), null)
  assert.equal(buildStatus(undefined, 'today', NOW), null)
  assert.equal(Array.from(buildStatus('x'.repeat(200), 'never', NOW).text).length, 60)
})

// ---------- what is shown ----------

test('a current status is shown, with its end time', () => {
  assert.deepEqual(statusOf({ status: { text: 'On leave', until: NOW + HOUR } }, NOW), { text: 'On leave', until: NOW + HOUR })
  assert.deepEqual(statusOf({ status: { text: 'On leave', until: null } }, NOW), { text: 'On leave', until: null })
})

test('an expired status is not shown, and one ending exactly now is over', () => {
  assert.equal(statusOf({ status: { text: 'x', until: NOW - 1 } }, NOW), null)
  assert.equal(statusOf({ status: { text: 'x', until: NOW } }, NOW), null)
  assert.notEqual(statusOf({ status: { text: 'x', until: NOW + 1 } }, NOW), null)
})

test('no status, or a person who is missing, shows nothing', () => {
  for (const u of [undefined, null, {}, { status: null }, { status: undefined }, { status: {} }, { status: { text: '' } }, { status: { text: '   ' } }]) {
    assert.equal(statusOf(u, NOW), null, JSON.stringify(u))
  }
})

test('a profile holding the wrong kind of thing shows nothing rather than breaking', () => {
  for (const status of ['On leave', 5, true, [], ['On leave'], { text: 5 }, { text: null }, { text: ['x'] }, { text: {} }]) {
    assert.equal(statusOf({ status }, NOW), null, JSON.stringify(status))
  }
})

test('text written straight into someone\'s profile is cleaned and cut on the way out', () => {
  const long = statusOf({ status: { text: 'y'.repeat(5000), until: null } }, NOW)
  assert.equal(Array.from(long.text).length, 60)
  assert.equal(statusOf({ status: { text: 'a\u202Eb\u0000c', until: null } }, NOW).text, 'a b c')
  assert.equal(statusOf({ status: { text: '<img src=x onerror=alert(1)>', until: null } }, NOW).text, '<img src=x onerror=alert(1)>', 'kept as text: it is never put into the page as markup')
})

test('an end time that is not a number is treated as no end, and is never allowed to hide a status by being odd', () => {
  for (const until of ['soon', NaN, Infinity, null, undefined, {}, '123']) {
    assert.equal(statusOf({ status: { text: 'x', until } }, NOW)?.until, null, String(until))
  }
})

test('only the text and the end time come out, whatever else is in there', () => {
  const s = statusOf({ status: { text: 'x', until: NOW + 5, emoji: '😀', secret: 'y' } }, NOW)
  assert.deepEqual(Object.keys(s).sort(), ['text', 'until'])
})

// ---------- the write, and the rules that allow it ----------

test('the write sets or removes only the status, cleaned again on the way in', () => {
  const db = read('src/lib/db.js')
  const start = db.indexOf('export async function setMyStatus')
  const fn = db.slice(start, db.indexOf('\nexport ', start + 10))
  assert.ok(fn.includes('if (!uid) return'))
  assert.ok(fn.includes('const text = cleanStatusText(status?.text)'))
  assert.ok(fn.includes("typeof status?.until === 'number' && Number.isFinite(status.until) ? status.until : null"))
  assert.ok(fn.includes("await updateDoc(doc(db, 'users', uid), { status: text ? { text, until } : deleteField() })"))
  assert.ok(!/setDoc|lastRead|role|email/.test(fn), 'nothing else is touched')
  assert.ok(db.includes("import { cleanStatusText } from './status'"))
})

test('the rules already let a person change this on their own profile: it is not a protected field', () => {
  const rules = read('firestore.rules')
  const users = rules.slice(rules.indexOf('match /users/{uid} {'), rules.indexOf('// Private notes: only the owner'))
  const list = /affectedKeys\(\)\s*\.hasAny\(\[([^\]]*)\]\)/.exec(users)
  assert.ok(list, 'the list of fields a person may not change was found')
  const names = list[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean)
  assert.ok(names.includes('role') && names.includes('email'), 'it is the right list')
  assert.ok(!names.includes('status'), 'so a status needs no rules change')
})

// ---------- where it shows ----------

test('your own panel shows it in place of your role, and a click on your name opens the dialog', () => {
  const p = read('src/components/UserPanel.jsx')
  assert.ok(p.includes('const myStatus = statusOf(me, now)'))
  assert.ok(p.includes("{activeChannel ? 'In voice' : myStatus ? myStatus.text : roleLabel(profile?.role)}"))
  assert.ok(p.includes('onClick={() => setStatusOpen(true)}'))
  assert.ok(p.includes("label: myStatus ? 'Change your status' : 'Set a status',"), 'and the gear menu has it too')
  assert.ok(p.includes('<StatusEditor open onClose={() => setStatusOpen(false)} current={me?.status} />'))
  assert.ok(p.includes("import { PreferencesModal, StatusEditor } from '../lib/lazyParts'"), 'loaded when first opened, not up front')
})

test('the member list, the DM list and the DM header show other people\'s', () => {
  const members = read('src/components/MembersPanel.jsx')
  // The row is built from the user PLUS a `status` for the online dot, which overwrites the profile's own `status`:
  // so what they wrote is taken from the user itself and carried under another name.
  assert.ok(members.includes('customStatus: statusOf(u, now),'))
  assert.ok(members.includes('const st = m.customStatus'))
  assert.ok(members.indexOf('customStatus: statusOf(u, now)') > members.indexOf('status: computeStatus(presence[u.id], now)') - 20, 'taken from the user u, not from the row')
  assert.ok(!members.includes('statusOf(m)'), 'the row\'s own `status` is the online dot, not a written status')
  assert.ok(members.includes('{st && <span className="block text-[11px] text-ink-dim truncate" title={st.text}>{st.text}</span>}'))
  const dms = read('src/components/DMsSidebar.jsx')
  assert.ok(dms.includes('const st = statusOf(u, now)'))
  assert.ok(dms.includes('{st && <span className="block text-[11px] font-normal text-ink-dim truncate" title={st.text}>{st.text}</span>}'))
  const view = read('src/views/DMConvo.jsx')
  assert.ok(view.includes('subtitle={statusOf(other)?.text}'))
})

test('a status is only ever shown as text, never put into the page as markup', () => {
  for (const f of ['src/components/UserPanel.jsx', 'src/components/MembersPanel.jsx', 'src/components/DMsSidebar.jsx', 'src/views/DMConvo.jsx', 'src/components/StatusEditor.jsx']) {
    assert.ok(!read(f).includes('dangerouslySetInnerHTML'), f)
  }
})

test('the dialog saves only a real status, clears only an existing one, and cannot be closed mid-save', () => {
  const e = read('src/components/StatusEditor.jsx')
  assert.ok(e.includes('const save = () => { if (clean && !busy) run(buildStatus(clean, expiry)) }'))
  assert.ok(e.includes("<button type=\"submit\" disabled={!clean || busy}"))
  assert.ok(e.includes('{existing && ('), 'nothing to clear: no clear button')
  assert.ok(e.includes('onClick={() => run(null)}'))
  assert.ok(e.includes('<Modal open={open} onClose={busy ? undefined : onClose} maxWidth="max-w-md">'))
  assert.ok(e.includes('maxLength={STATUS_MAX}'))
  assert.ok(e.includes("const [expiry, setExpiry] = useState('today')"))
  assert.ok(e.includes("setError(\"Couldn't save your status. Try again.\")"), 'a failure says so in plain words and lets them try again')
  assert.ok(e.includes('setBusy(false)'))
  assert.ok(e.includes('STATUS_PRESETS.map('))
})

test('the dialog is its own chunk, loaded on first use', () => {
  const lazy = read('src/lib/lazyParts.js')
  assert.ok(lazy.includes("export const StatusEditor = lazyWithPreload(() => import('../components/StatusEditor'))"))
  assert.ok(!/preloadCommon = .*StatusEditor/.test(lazy))
})

// ---------- the source stays readable ----------

test('no invisible or text-direction character sits raw in the status code or its tests', () => {
  // They are written as visible \u escapes. A raw one is invisible in an editor and can reorder the code around it.
  const BS = String.fromCharCode(92)
  const hex = ['200B', '200C', '200D', '200E', '200F', '202A', '202B', '202C', '202D', '202E', '2060', '2066', '2067', '2068', '2069', 'FEFF']
  const raw = new RegExp('[' + hex.map((h) => BS + 'u' + h).join('') + ']')
  for (const f of ['src/lib/status.js', 'src/components/StatusEditor.jsx', 'tests/status.test.mjs']) {
    assert.ok(!raw.test(read(f).replace(/^\uFEFF/, '')), f + ' holds a raw invisible character')
  }
  assert.ok(read('src/lib/status.js').includes(BS + 'u202E'), 'and the pattern really is written out as escapes')
})
