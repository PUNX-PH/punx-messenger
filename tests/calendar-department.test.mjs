// The calendar's department filter.
//
//   node --test tests/calendar-department.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  DEPT_ALL, DEPT_KEY, DEPT_UNASSIGNED, departmentOptions, effectiveDepartment, eventsForDate, filterLeaves,
  readDepartment, writeDepartment,
} from '../src/lib/dtrCalendar.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const DEPTS = { d2: 'Game Development', d1: 'Creatives', d3: 'AI Labs' }
const leave = (id, departmentId, over = {}) => ({ id, userName: 'P' + id, departmentId, type: 'vacation', startDate: '2026-11-10', endDate: '2026-11-10', hours: 0, ...over })

// ---------- the choices ----------

test('the choices are "All departments", then the departments A to Z', () => {
  const o = departmentOptions(DEPTS, [leave('a', 'd1')])
  assert.deepEqual(o.map(x => x.label), ['All departments', 'AI Labs', 'Creatives', 'Game Development'])
  assert.deepEqual(o.map(x => x.value), [DEPT_ALL, 'd3', 'd1', 'd2'])
})

test('a department with the same name as another still gets its own choice, in a steady order', () => {
  const o = departmentOptions({ b: 'Ops', a: 'Ops' }, [])
  assert.deepEqual(o.map(x => x.value), [DEPT_ALL, 'a', 'b'])
})

test('names are trimmed, and blank or non-text names and blank ids are left out', () => {
  const o = departmentOptions({ a: '  Creatives  ', b: '', c: '   ', d: 5, e: null, '': 'No id' }, [])
  assert.deepEqual(o.map(x => x.label), ['All departments', 'Creatives'])
})

test('with no department names there is only "All departments" (so the panel shows no filter)', () => {
  for (const none of [undefined, null, {}, [], 'text', 5]) assert.equal(departmentOptions(none, []).length, 1, JSON.stringify(none))
})

test('a list instead of the { id: name } object is no names at all, not names "0", "1"...', () => {
  assert.equal(departmentOptions(['Creatives', 'AI Labs'], []).length, 1)
  assert.deepEqual(filterLeaves([leave('a', '0')], DEPT_UNASSIGNED, ['Creatives']).map(l => l.id), ['a'], 'nobody has a known department')
})

test('a blank id in the list does not make a blank department "known"', () => {
  const names = { '': 'No id', d1: 'Creatives' }
  assert.deepEqual(filterLeaves([leave('a', ''), leave('b', 'd1')], DEPT_UNASSIGNED, names).map(l => l.id), ['a'])
  assert.ok(departmentOptions(names, [leave('a', '')]).some(o => o.value === DEPT_UNASSIGNED))
})

test('"No department" is offered when someone on leave has none that is known, and not otherwise', () => {
  const labels = (leaves, sel) => departmentOptions(DEPTS, leaves, sel).map(x => x.label)
  assert.ok(!labels([leave('a', 'd1'), leave('b', 'd2')]).includes('No department'), 'everyone has one')
  assert.ok(labels([leave('a', 'd1'), leave('b', '')]).includes('No department'), 'a blank department')
  assert.ok(labels([leave('a', 'gone')]).includes('No department'), 'a department that is not in the list')
  assert.ok(labels([leave('a', undefined)]).includes('No department'), 'no field at all')
  assert.ok(labels([leave('a', 'toString')]).includes('No department'), 'an inherited name is not a department')
  assert.ok(!labels([]).includes('No department'), 'nobody on leave')
  assert.equal(departmentOptions(DEPTS, [leave('a', 'd1')]).at(-1).value !== DEPT_UNASSIGNED, true)
})

test('"No department" stays on offer while it is the chosen one, so the choice never vanishes', () => {
  const o = departmentOptions(DEPTS, [leave('a', 'd1')], DEPT_UNASSIGNED)
  assert.equal(o.at(-1).value, DEPT_UNASSIGNED)
  assert.equal(effectiveDepartment(DEPT_UNASSIGNED, o), DEPT_UNASSIGNED)
})

// ---------- the filtering ----------

const LEAVES = [leave('a', 'd1'), leave('b', 'd2'), leave('c', 'd1'), leave('d', ''), leave('e', 'gone'), leave('f', 'toString')]

test('everyone is the default and returns the leave untouched', () => {
  assert.equal(filterLeaves(LEAVES, DEPT_ALL, DEPTS), LEAVES)
})

test('one department keeps only its people', () => {
  assert.deepEqual(filterLeaves(LEAVES, 'd1', DEPTS).map(l => l.id), ['a', 'c'])
  assert.deepEqual(filterLeaves(LEAVES, 'd2', DEPTS).map(l => l.id), ['b'])
  assert.deepEqual(filterLeaves(LEAVES, 'd3', DEPTS), [], 'a department with nobody on leave')
})

test('"No department" keeps people with none, an unknown one, or an inherited-looking one', () => {
  assert.deepEqual(filterLeaves(LEAVES, DEPT_UNASSIGNED, DEPTS).map(l => l.id), ['d', 'e', 'f'])
})

test('the filter value is never treated as a pattern or an inherited property', () => {
  assert.deepEqual(filterLeaves(LEAVES, 'd', DEPTS), [], 'no partial matching')
  assert.deepEqual(filterLeaves(LEAVES, '.*', DEPTS), [])
  assert.deepEqual(filterLeaves(LEAVES, 'toString', DEPTS).map(l => l.id), ['f'], 'an exact id, nothing more')
})

test('bad input gives an empty list, not a crash', () => {
  assert.deepEqual(filterLeaves(undefined, 'd1', DEPTS), [])
  assert.deepEqual(filterLeaves(null, DEPT_ALL, DEPTS), [])
  assert.deepEqual(filterLeaves(LEAVES, DEPT_UNASSIGNED, undefined).length, LEAVES.length, 'with no names nobody has a known department')
})

test('a filtered list feeds the day view, so the grid and the list agree', () => {
  const day = (v) => eventsForDate('2026-11-10', { leaves: filterLeaves(LEAVES, v, DEPTS) }).leaves.length
  assert.equal(day(DEPT_ALL), 6)
  assert.equal(day('d1'), 2)
  assert.equal(day(DEPT_UNASSIGNED), 3)
})

// ---------- what was chosen last time ----------

test('a remembered choice that is no longer on offer means everyone', () => {
  const o = departmentOptions(DEPTS, [leave('a', 'd1')])
  assert.equal(effectiveDepartment('d1', o), 'd1')
  assert.equal(effectiveDepartment('removed', o), DEPT_ALL)
  assert.equal(effectiveDepartment(DEPT_UNASSIGNED, o), DEPT_ALL, '"No department" with nobody in it')
  assert.equal(effectiveDepartment(undefined, o), DEPT_ALL)
  assert.equal(effectiveDepartment('d1', undefined), DEPT_ALL)
})

const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m } }

test('the choice is kept on the device, and "everyone" clears it', () => {
  const st = memory()
  assert.equal(readDepartment(st), DEPT_ALL, 'nothing saved')
  writeDepartment(st, 'd2')
  assert.equal(st.m.get(DEPT_KEY), 'd2')
  assert.equal(readDepartment(st), 'd2')
  writeDepartment(st, DEPT_UNASSIGNED)
  assert.equal(readDepartment(st), DEPT_UNASSIGNED)
  writeDepartment(st, DEPT_ALL)
  assert.equal(st.m.has(DEPT_KEY), false, 'cleared, not stored as an empty string')
  assert.equal(readDepartment(st), DEPT_ALL)
})

test('storage that is missing, throws, or holds junk never breaks the calendar', () => {
  const boom = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(readDepartment(boom), DEPT_ALL)
  assert.doesNotThrow(() => writeDepartment(boom, 'd1'))
  assert.doesNotThrow(() => writeDepartment(boom, DEPT_ALL))
  assert.equal(readDepartment(undefined), DEPT_ALL)
  assert.doesNotThrow(() => writeDepartment(undefined, 'd1'))
  const junk = memory(); junk.setItem(DEPT_KEY, 'x'.repeat(500))
  assert.equal(readDepartment(junk), DEPT_ALL, 'an absurdly long value is ignored')
  junk.setItem(DEPT_KEY, '')
  assert.equal(readDepartment(junk), DEPT_ALL)
})

test('the key does not collide with the calendar\'s other stored setting', () => {
  assert.equal(DEPT_KEY, 'punx.calendarDepartment')
  assert.notEqual(DEPT_KEY, 'punx.calendarPinned')
})

// ---------- the wiring ----------

test('the panel filters the people on leave but never the holidays, and the grid and the list use the same result', () => {
  const src = lf(fs.readFileSync('src/components/CalendarPanel.jsx', 'utf8'))
  assert.ok(src.includes('const holidayIndex = useMemo(() => holidaysByDate(data?.holidays || []), [data])'), 'holidays are not filtered')
  assert.ok(src.includes('const leaves = useMemo(() => filterLeaves(allLeaves, activeDept, data?.departments), [data, activeDept])'))
  assert.ok(src.includes('const detail = eventsForDate(selected, { holidayIndex, leaves })'), 'the day list uses the filtered leave')
  assert.ok(src.includes('const ev = eventsForDate(c.ymd, { holidayIndex, leaves })'), 'and so does every cell of the grid')
})

test('the choice is remembered, validated against what is on offer, and shown only when there is a choice', () => {
  const src = lf(fs.readFileSync('src/components/CalendarPanel.jsx', 'utf8'))
  assert.ok(src.includes('useState(() => readDepartment(storage()))'), 'read once on opening')
  assert.ok(src.includes('const activeDept = effectiveDepartment(dept, options)'), 'a stale choice falls back to everyone')
  assert.ok(src.includes('const chooseDept = (value) => { setDept(value); writeDepartment(storage(), value) }'))
  assert.ok(src.includes("state.status === 'ready' && options.length > 1 && ("), 'not while loading or failed, and not with nothing to choose')
  assert.ok(src.includes('onChange={(e) => chooseDept(e.target.value)}') && src.includes('value={activeDept}'))
  assert.ok(src.includes('aria-label="Show leave for"'), 'the select has a name for screen readers')
})
