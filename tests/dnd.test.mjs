// Do not disturb: when it ends, when it counts as on, what it silences (and what it must not),
// how it reads, and that it is wired into the daemon, the panel and the identity.
//
//   node --test tests/dnd.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  DND_OPTIONS, MORNING_HOUR, announcePlan, buildDnd, dndLabel, dndOf, dndUntil,
} from '../src/lib/dnd.js'
import { identityOf } from '../src/lib/usersIdentity.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (f) => lf(fs.readFileSync(f, 'utf8'))
const MIN = 60000
const HOUR = 3600000
const at = (h, m = 0, day = 13) => new Date(2026, 10, day, h, m, 0, 0).getTime() // November 2026, local time
const NOW = at(14, 30)

// ---------- when it ends ----------

test('the timed choices end that long from now', () => {
  assert.equal(dndUntil('30m', NOW), NOW + 30 * MIN)
  assert.equal(dndUntil('1h', NOW), NOW + HOUR)
  assert.equal(dndUntil('4h', NOW), NOW + 4 * HOUR)
})

test('"until I turn it off", and anything unknown, has no end', () => {
  for (const id of ['never', 'nope', '', undefined, null, 5]) assert.equal(dndUntil(id, NOW), null, String(id))
})

test('the morning is the next 8:00 on the person’s own clock', () => {
  assert.equal(MORNING_HOUR, 8)
  assert.equal(dndUntil('morning', at(14, 30)), at(8, 0, 14), 'in the afternoon: tomorrow')
  assert.equal(dndUntil('morning', at(23, 59)), at(8, 0, 14), 'late at night: tomorrow')
  assert.equal(dndUntil('morning', at(3, 0)), at(8, 0, 13), 'before 8: this morning, not a day later')
  assert.equal(dndUntil('morning', at(7, 59)), at(8, 0, 13), 'one minute before')
  assert.equal(dndUntil('morning', at(8, 0)), at(8, 0, 14), 'at 8:00 exactly it is already morning: tomorrow')
  assert.equal(dndUntil('morning', at(8, 1)), at(8, 0, 14))
})

test('the morning rolls over the end of a month and a year', () => {
  assert.equal(dndUntil('morning', new Date(2026, 10, 30, 20, 0).getTime()), new Date(2026, 11, 1, 8, 0).getTime())
  assert.equal(dndUntil('morning', new Date(2026, 11, 31, 20, 0).getTime()), new Date(2027, 0, 1, 8, 0).getTime())
})

test('what is stored for a choice is just a time or null', () => {
  assert.deepEqual(buildDnd('1h', NOW), { until: NOW + HOUR })
  assert.deepEqual(buildDnd('never', NOW), { until: null })
})

test('the choices are labelled, unique, and each one means something', () => {
  assert.ok(DND_OPTIONS.length >= 4)
  assert.equal(new Set(DND_OPTIONS.map((o) => o.id)).size, DND_OPTIONS.length)
  for (const o of DND_OPTIONS) {
    assert.ok(o.label && o.label.trim() === o.label, o.id)
    const until = dndUntil(o.id, NOW)
    assert.ok(until === null || until > NOW, `${o.id} must end in the future`)
  }
  assert.equal(DND_OPTIONS.filter((o) => dndUntil(o.id, NOW) === null).length, 1, 'exactly one choice has no end')
  assert.equal(DND_OPTIONS.at(-1).id, 'never', 'the open-ended one is last')
})

// ---------- is it on ----------

test('on with a time in the future, with its end', () => {
  assert.deepEqual(dndOf({ dnd: { until: NOW + 1 } }, NOW), { until: NOW + 1 })
  assert.deepEqual(dndOf({ dnd: { until: NOW + 10 * HOUR } }, NOW), { until: NOW + 10 * HOUR })
})

test('on for ever when the end is an explicit null', () => {
  assert.deepEqual(dndOf({ dnd: { until: null } }, NOW), { until: null })
})

test('off once the time has come, at the very moment, and after', () => {
  assert.equal(dndOf({ dnd: { until: NOW } }, NOW), null, 'the moment itself is over')
  assert.equal(dndOf({ dnd: { until: NOW - 1 } }, NOW), null)
  assert.equal(dndOf({ dnd: { until: 0 } }, NOW), null)
})

test('a field that is missing or the wrong shape is OFF, never on for ever', () => {
  const bad = [
    undefined, null, {}, { dnd: null }, { dnd: undefined }, { dnd: true }, { dnd: 'on' }, { dnd: 5 }, { dnd: [] }, { dnd: [{ until: null }] },
    { dnd: {} }, { dnd: { until: undefined } }, { dnd: { until: '99999999999999' } }, { dnd: { until: NaN } },
    { dnd: { until: Infinity } }, { dnd: { until: -Infinity } }, { dnd: { until: {} } }, { dnd: { until: true } }, { dnd: { until: [] } },
  ]
  for (const u of bad) assert.equal(dndOf(u, NOW), null, JSON.stringify(u))
})

test('with no time given it uses the real clock', () => {
  assert.ok(dndOf({ dnd: { until: Date.now() + HOUR } }))
  assert.equal(dndOf({ dnd: { until: Date.now() - HOUR } }), null)
})

// ---------- what it says ----------

test('the same day: "until 3:40 PM" / "until 15:40", in the person’s clock', () => {
  const dnd = { until: at(15, 40) }
  assert.equal(dndLabel(dnd, NOW, '12h', 'en-US'), 'until 3:40 PM')
  assert.equal(dndLabel(dnd, NOW, '24h', 'en-US'), 'until 15:40')
})

test('the next day says "tomorrow", and further away says which day', () => {
  assert.equal(dndLabel({ until: at(8, 0, 14) }, NOW, '12h', 'en-US'), 'until tomorrow 8:00 AM')
  assert.equal(dndLabel({ until: at(8, 0, 14) }, NOW, '24h', 'en-US'), 'until tomorrow 08:00')
  assert.equal(dndLabel({ until: at(9, 0, 17) }, NOW, '24h', 'en-US'), 'until Tue, Nov 17 09:00')
})

test('the same day of ANOTHER month is not "today" or "tomorrow"', () => {
  const nextMonth = (day, h = 9) => new Date(2026, 11, day, h, 0).getTime()
  assert.equal(dndLabel({ until: nextMonth(13) }, NOW, '24h', 'en-US'), 'until Sun, Dec 13 09:00', 'a month on, same date: not "until 09:00"')
  assert.equal(dndLabel({ until: nextMonth(14) }, NOW, '24h', 'en-US'), 'until Mon, Dec 14 09:00', 'a month and a day on: not "tomorrow"')
  assert.equal(dndLabel({ until: new Date(2027, 10, 13, 9, 0).getTime() }, NOW, '24h', 'en-US').startsWith('until Sat, Nov 13'), true, 'a year on, same date')
})

test('tomorrow is tomorrow even across the end of a month', () => {
  const now = new Date(2026, 10, 30, 22, 0).getTime()
  assert.equal(dndLabel({ until: new Date(2026, 11, 1, 8, 0).getTime() }, now, '12h', 'en-US'), 'until tomorrow 8:00 AM')
})

test('no end says so, and off says nothing', () => {
  assert.equal(dndLabel({ until: null }, NOW), 'until you turn it off')
  assert.equal(dndLabel(null, NOW), '')
  assert.equal(dndLabel(undefined, NOW), '')
})

// ---------- what it silences ----------

test('normally: the ping plays unless you are looking at that conversation, and the notification shows when allowed', () => {
  assert.deepEqual(announcePlan({ sound: true, looking: false, canNotify: true }), { ping: true, notify: true })
  assert.deepEqual(announcePlan({ sound: true, looking: true, canNotify: true }), { ping: false, notify: true }, 'looking at it: no ping')
  assert.deepEqual(announcePlan({ sound: true, looking: false, canNotify: false }), { ping: true, notify: false }, 'tab in front: ping, no notification')
  assert.deepEqual(announcePlan({ sound: false, looking: false, canNotify: true }), { ping: false, notify: true }, 'a mention has no ping')
  assert.deepEqual(announcePlan({ sound: false, looking: false, canNotify: false }), { ping: false, notify: false })
})

test('do not disturb silences both, whatever else is true', () => {
  for (const sound of [true, false]) for (const looking of [true, false]) for (const canNotify of [true, false]) {
    assert.deepEqual(announcePlan({ dnd: true, sound, looking, canNotify }), { ping: false, notify: false }, JSON.stringify({ sound, looking, canNotify }))
  }
})

test('with nothing said, nothing happens', () => {
  assert.deepEqual(announcePlan(), { ping: false, notify: false })
  assert.deepEqual(announcePlan({}), { ping: false, notify: false })
})

// ---------- where it lives ----------

test('it is private to you: other people’s copy of your profile does not carry it, and yours does', () => {
  const user = { id: 'a', name: 'Ana', dnd: { until: null } }
  assert.equal('dnd' in identityOf(user, false), false, 'not shown to, and never redraws, anyone else')
  assert.deepEqual(identityOf(user, true).dnd, { until: null }, 'your own device needs it')
})

test('the daemon asks announcePlan, reads do-not-disturb at the moment a message arrives, and still records the message', () => {
  const src = read('src/lib/notifications.jsx')
  assert.match(src, /import \{ announcePlan, dndOf \} from '\.\/dnd'/)
  assert.match(src, /dnd: !!dndOf\(byIdRef\.current\[profile\?\.id\]\)/, 'read through the ref, at the moment, so flipping it or running out needs no re-subscribing')
  assert.match(src, /if \(plan\.ping\) playSfx\('dm_ping'\)/)
  assert.match(src, /if \(!plan\.notify\) return/)
  const fire = src.slice(src.indexOf('const fire ='), src.indexOf('// ── DMs'))
  assert.ok(fire.indexOf('lastByKey.current.set(key, stamp)') >= 0, 'it is recorded')
  assert.ok(fire.indexOf('lastByKey.current.set(key, stamp)') < fire.indexOf('announcePlan('),
    'the message is recorded as seen BEFORE do-not-disturb is considered, so nothing replays as a burst when it ends')
  assert.ok(!/playSfx\('dm_ping'\)[^]*playSfx\('dm_ping'\)/.test(fire), 'one place plays the ping')
})

test('setMyDnd writes only a time or null, and null removes the field', () => {
  const src = read('src/lib/db.js')
  const fn = src.slice(src.indexOf('export async function setMyDnd'))
  assert.match(fn, /if \(!uid\) return/)
  assert.match(fn, /Number\.isFinite\(dnd\?\.until\) \? dnd\.until : null/)
  assert.match(fn, /\{ dnd: dnd \? \{ until \} : deleteField\(\) \}/)
  assert.match(fn.slice(0, 400), /updateDoc\(doc\(db, 'users', uid\)/, 'a field of your own profile: the rules need no change')
})

test('the panel: a menu entry that turns it on or off, an indicator, a red dot on your own avatar, the dialog loaded on demand', () => {
  const src = read('src/components/UserPanel.jsx')
  assert.match(src, /const dnd = dndOf\(me, now\)/, 'decided with the ticking clock, so it switches itself off when it runs out')
  assert.match(src, /label: 'Do not disturb…'/)
  assert.match(src, /Turn off do not disturb \(\$\{dndLabel\(dnd, now, prefs\.timeFormat\)\}\)/)
  assert.match(src, /status=\{dnd \? 'dnd' : status\}/)
  assert.match(src, /<DndDialog open onClose=\{\(\) => setDndOpen\(false\)\} \/>/, 'closes itself')
  assert.match(src, /\{dnd && \(\s*<FlatIconButton onClick=\{turnOffDnd\} active/, 'the indicator is there only while it is on, and turns it off')
  assert.match(src, /activeChannel \? 'In voice' : myStatus \? myStatus\.text : roleLabel/, 'the line under your name still shows your status: do not disturb does not replace it')
  assert.match(src, /setMyDnd\(profile\?\.id, null\)/, 'turning off writes null')
  assert.match(read('src/lib/lazyParts.js'), /export const DndDialog = lazyWithPreload\(\(\) => import\('\.\.\/components\/DndDialog'\)\)/)
  assert.match(read('src/components/Avatar.jsx'), /status === 'dnd' \? 'bg-bad'/)
})

test('the dialog turns it on with one click on a choice and shows a failure', () => {
  const src = read('src/components/DndDialog.jsx')
  assert.match(src, /await setMyDnd\(profile\?\.id, buildDnd\(id\)\)/)
  assert.match(src, /DND_OPTIONS\.map/)
  assert.match(src, /if \(busy\) return/, 'a second click while one is going does nothing')
  assert.match(src, /catch \{\s*setError\("Couldn't turn it on\. Try again\."\)\s*setBusy\(false\)\s*\}/, 'after a failure the choices come back')
  assert.match(src, /role="alert"/)
  assert.match(src, /Modal open=\{open\} onClose=\{busy \? undefined : onClose\}/, 'cannot be dismissed mid-save')
})
