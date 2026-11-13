// Saved messages: what is kept, under what id, the way back to the original, and that the
// bookmark button, the save and the label are wired together.
//
//   node --test tests/saved.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isSavedNote, originalRoute, savedNoteId, savedPayload, savedRouteOf } from '../src/lib/saved.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const CH = 'groups/G1abc/channels/C2def/messages'

// ---------- the note's id ----------

test('a saved message is one note, named after the message', () => {
  assert.equal(savedNoteId('Xy12abCD'), 's_Xy12abCD')
  assert.equal(savedNoteId('a_b-1'), 's_a_b-1')
  assert.equal(savedNoteId('Xy12abCD'), savedNoteId('Xy12abCD'), 'the same message, the same note')
  assert.notEqual(savedNoteId('a1'), savedNoteId('a2'))
})

test('a message with no usable id cannot be saved', () => {
  for (const id of ['', 'a b', 'a/b', 'a.b', 'x'.repeat(65), null, undefined, 7, {}]) assert.equal(savedNoteId(id), null, String(id))
  assert.equal(savedNoteId('x'.repeat(64)), 's_' + 'x'.repeat(64))
})

// ---------- the way back ----------

test('a channel message has an in-app way back, anything else does not', () => {
  assert.equal(originalRoute(CH, 'Xy12abCD'), '/g/G1abc/c/C2def?m=Xy12abCD')
  assert.equal(originalRoute('dms/a_b/messages', 'x1'), null)
  assert.equal(originalRoute('users/me/notes', 'x1'), null)
  assert.equal(originalRoute('groups/G1/channels/C1', 'x1'), null)
  assert.equal(originalRoute(CH + '/x', 'x1'), null)
  assert.equal(originalRoute('x/' + CH, 'x1'), null, 'the path has to start there')
  assert.equal(originalRoute(CH, 'a b'), null)
  assert.equal(originalRoute(CH, ''), null)
  assert.equal(originalRoute(CH, null), null)
  assert.equal(originalRoute(null, 'x1'), null)
  assert.equal(originalRoute(undefined, 'x1'), null)
  assert.equal(originalRoute(7, 'x1'), null)
})

test('the route is the one a link to that message makes', () => {
  assert.equal(originalRoute(CH, 'x1'), new URL('https://h.test/g/G1abc/c/C2def?m=x1').pathname + new URL('https://h.test/g/G1abc/c/C2def?m=x1').search)
})

test('the way back is read again, and can only lead into the app', () => {
  assert.equal(savedRouteOf({ savedFrom: { route: '/g/G1/c/C1?m=abc' } }), '/g/G1/c/C1?m=abc')
  for (const r of [
    'https://evil.test/', '//evil.test/g/G1/c/C1?m=abc', 'javascript:alert(1)', '/g/G1/c/C1', '/g/G1/c/C1?m=', '/g/G1/c/C1?m=a b',
    '/g/G1/c/C1?m=abc&x=1', '/g/G1/c/C1?m=abc#x', '/admin', '/g/G1/c/C1/../../admin?m=a', '', null, undefined, 5, {}, ['/g/G1/c/C1?m=abc'],
  ]) assert.equal(savedRouteOf({ savedFrom: { route: r } }), null, String(r))
  assert.equal(savedRouteOf({}), null)
  assert.equal(savedRouteOf(null), null)
  assert.equal(savedRouteOf({ savedFrom: 'x' }), null)
})

test('a saved note is told from one you typed or a plain forward', () => {
  assert.equal(isSavedNote({ savedFrom: { route: null } }), true)
  assert.equal(isSavedNote({ savedFrom: {} }), true)
  for (const m of [null, undefined, {}, { savedFrom: null }, { savedFrom: 'x' }, { savedFrom: [] }, { savedFrom: 5 }, { forwardedFrom: { name: 'A' } }]) assert.equal(isSavedNote(m), false, JSON.stringify(m))
})

// ---------- what is kept ----------

const users = { u1: { name: 'Ana Reyes' }, meuid1: { name: 'Me Myself' } }
const msg = { id: 'Xy12abCD', author: { uid: 'u1', name: 'Ana' }, text: 'ship it, <@meuid1>', reactions: { '👍': ['u2'] }, pinned: true }

test('the same copy a forward makes, plus where it came from', () => {
  const p = savedPayload(msg, users, CH)
  assert.deepEqual(Object.keys(p).sort(), ['forwardedFrom', 'imageMeta', 'imageURL', 'savedFrom', 'text'])
  assert.equal(p.text, 'ship it, @Me Myself', 'mentions as names, so a note never pings')
  assert.deepEqual(p.forwardedFrom, { uid: 'u1', name: 'Ana Reyes' })
  assert.deepEqual(p.savedFrom, { route: '/g/G1abc/c/C2def?m=Xy12abCD' })
})

test('from a DM there is no way back, but it is still saved', () => {
  const p = savedPayload(msg, users, 'dms/a_b/messages')
  assert.deepEqual(p.savedFrom, { route: null })
  assert.equal(p.text, 'ship it, @Me Myself')
})

test('a picture is kept with its details', () => {
  const p = savedPayload({ id: 'm1', author: { uid: 'u1' }, text: '', imageURL: 'data:image/png;base64,AA', imageMeta: { width: 2 } }, users, CH)
  assert.equal(p.imageURL, 'data:image/png;base64,AA')
  assert.deepEqual(p.imageMeta, { width: 2 })
})

test('saving a forward keeps the ORIGINAL writer', () => {
  const p = savedPayload({ ...msg, forwardedFrom: { uid: 'u9', name: 'Cara' } }, users, CH)
  assert.deepEqual(p.forwardedFrom, { uid: 'u9', name: 'Cara' })
})

test('nothing to save gives nothing, and the original is not changed', () => {
  assert.equal(savedPayload({ id: 'm1', text: '' }, users, CH), null)
  assert.equal(savedPayload(null, users, CH), null)
  const copy = JSON.parse(JSON.stringify(msg))
  savedPayload(msg, users, CH)
  assert.deepEqual(msg, copy)
})

// ---------- wired together ----------

test('saving writes into the person\'s own notes, once per message', () => {
  const d = read('src/lib/db.js')
  const at = d.indexOf('export async function saveMessageToNotes')
  assert.ok(at > 0)
  const fn = d.slice(at, d.indexOf('// Toggle the pinned flag', at))
  assert.ok(fn.includes("doc(db, 'users', me.uid, 'notes', noteId)"))
  assert.ok(fn.includes("if ((await getDoc(ref)).exists()) return 'exists'"))
  assert.ok(fn.indexOf('getDoc(ref)') < fn.indexOf('await setDoc(ref'))
  assert.ok(fn.includes("author: { uid: me.uid, name: me.name, photoURL: me.photoURL || null }"))
  assert.ok(fn.includes('mentionedUids: [],'), 'a note never pings anyone')
  assert.ok(fn.includes('text: payload.text,'))
  assert.ok(fn.includes('imageURL: payload.imageURL,'))
  assert.ok(fn.includes('imageMeta: payload.imageMeta,'))
  assert.ok(fn.includes('forwardedFrom: payload.forwardedFrom,'))
  assert.ok(fn.includes('savedFrom: payload.savedFrom,'))
  assert.ok(fn.includes("return 'saved'"))
})

test('the chat offers Save except in My Notes and in a read-only view, and a failure is "not saved"', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes("const inNotes = path.startsWith('users/')"))
  assert.ok(s.includes('onSave={readOnly || inNotes ? null : saveMessage}'))
  assert.ok(s.includes('const id = savedNoteId(m.id)'))
  assert.ok(s.includes('const payload = savedPayload(m, usersByIdRef.current, path)'))
  assert.ok(s.includes('if (!id || !payload || !profile?.uid) return false'))
  assert.ok(s.includes('try { return await saveMessageToNotes(profile, id, payload) } catch { return false }'))
  assert.ok(s.includes('}, [path, profile])'))
})

test('each message that can be saved gets a bookmark button that says what happened', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('{onSave && canForward(message) && ('))
  assert.ok(l.includes('onClick={saveMessage}'))
  assert.ok(l.includes("title={saveFlash ? saveResult.current : 'Save to My Notes'}"))
  assert.ok(l.includes("aria-label={saveFlash ? saveResult.current : 'Save to My Notes'}"))
  assert.ok(l.includes('{saveFlash ? <CheckIcon /> : <BookmarkIcon />}'))
  assert.ok(l.includes("saveResult.current = r === 'exists' ? 'Already saved' : 'Saved to My Notes'"))
  assert.ok(l.includes('if (r) { saveResult.current'), 'nothing is flashed when it failed')
  assert.equal(l.split('onSave={onSave}').length - 1, 2, 'handed through the group to every row')
  assert.ok(l.includes('onForward || onSave || canPin'))
})

test('a saved note says where it was saved from, and offers the way back inside the app', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('const savedNote = isSavedNote(message)'))
  assert.ok(l.includes('{savedNote ? <BookmarkIcon /> : <ForwardIcon />}'))
  assert.ok(l.includes('const savedRoute = savedRouteOf(message)'))
  assert.ok(l.includes("{savedNote ? 'Saved from' : 'Forwarded from'}"))
  assert.ok(l.includes('{savedRoute && <Link to={savedRoute}'))
  assert.ok(l.includes('Go to message'))
  assert.ok(l.includes("import { Link } from 'react-router-dom'"))
})
