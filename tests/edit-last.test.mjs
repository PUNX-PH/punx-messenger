// Edit your last message with the up arrow: when the key counts, which message it opens,
// and that the pieces are wired together.
//
//   node --test tests/edit-last.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { shouldEditLast, lastEditableMessage } from '../src/lib/editLast.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const key = (over = {}) => ({ key: 'ArrowUp', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, ...over })

// ---------- when the key counts ----------

test('a plain up arrow in an empty box edits the last message', () => {
  assert.equal(shouldEditLast(key(), { text: '' }), true)
  assert.equal(shouldEditLast(key()), true, 'no options at all is an empty box')
  assert.equal(shouldEditLast(key(), { text: '   \n ' }), true, 'only spaces is still empty')
})

test('not when there is anything written', () => {
  assert.equal(shouldEditLast(key(), { text: 'hello' }), false)
  assert.equal(shouldEditLast(key(), { text: ' a ' }), false)
})

test('not with a picture or file waiting to be sent', () => {
  assert.equal(shouldEditLast(key(), { text: '', hasFile: true }), false)
})

test('not while the @ list is open: it uses the up arrow itself', () => {
  assert.equal(shouldEditLast(key(), { text: '', mentionOpen: true }), false)
})

test('not with a modifier, a different key, an input method composing, or a key already handled', () => {
  for (const m of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) assert.equal(shouldEditLast(key({ [m]: true }), { text: '' }), false, m)
  for (const k of ['ArrowDown', 'ArrowLeft', 'Enter', 'Escape', 'a']) assert.equal(shouldEditLast(key({ key: k }), { text: '' }), false, k)
  assert.equal(shouldEditLast(key({ isComposing: true }), { text: '' }), false)
  assert.equal(shouldEditLast(key({ defaultPrevented: true }), { text: '' }), false)
  assert.equal(shouldEditLast(null, { text: '' }), false)
  assert.equal(shouldEditLast(undefined), false)
})

test('a text that is not a string counts as empty rather than throwing', () => {
  assert.equal(shouldEditLast(key(), { text: null }), true)
  assert.equal(shouldEditLast(key(), { text: 42 }), false)
})

// ---------- which message ----------

const m = (id, uid, text) => ({ id, author: { uid }, text })

test('it is the newest message of mine, not of anyone else', () => {
  const list = [m('1', 'me', 'first'), m('2', 'you', 'hi'), m('3', 'me', 'second'), m('4', 'you', 'ok')]
  assert.equal(lastEditableMessage(list, 'me').id, '3')
  assert.equal(lastEditableMessage(list, 'you').id, '4')
})

test('a picture on its own, or a blank text, has nothing to edit and is skipped', () => {
  const list = [m('1', 'me', 'words'), { id: '2', author: { uid: 'me' }, imageURL: 'x' }, m('3', 'me', '  '), m('4', 'me', undefined)]
  assert.equal(lastEditableMessage(list, 'me').id, '1')
  assert.equal(lastEditableMessage([list[1], list[2]], 'me'), null)
})

test('nothing of mine, nobody signed in, or no list: null', () => {
  assert.equal(lastEditableMessage([m('1', 'you', 'hi')], 'me'), null)
  assert.equal(lastEditableMessage([m('1', 'me', 'hi')], undefined), null)
  assert.equal(lastEditableMessage([m('1', 'me', 'hi')], ''), null)
  assert.equal(lastEditableMessage(undefined, 'me'), null)
  assert.equal(lastEditableMessage([], 'me'), null)
  assert.equal(lastEditableMessage([null, { id: 'x' }, { id: 'y', author: null, text: 'a' }], 'me'), null)
})

test('a message with no author is never mine, even when I have no uid yet written', () => {
  assert.equal(lastEditableMessage([{ id: '1', text: 'a' }], 'me'), null)
  // ...and with nobody signed in, a message with no author must not match "undefined is undefined".
  assert.equal(lastEditableMessage([{ id: '1', text: 'a' }], undefined), null)
  assert.equal(lastEditableMessage([{ id: '1', author: {}, text: 'a' }], undefined), null)
})

// ---------- wired together ----------

test('the box asks for it only when there is a handler, and keeps the key for itself when there was no message', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes("import { shouldEditLast } from '../lib/editLast'"))
  assert.ok(c.includes('onEditLast = null'))
  assert.ok(c.includes('if (onEditLast && shouldEditLast(e, { text, hasFile: !!file, mentionOpen: !!(mention && mentionCandidates.length > 0) || suggestOpen }))'))
  // The key is only swallowed when a message was found.
  assert.ok(c.includes('if (onEditLast()) e.preventDefault()'))
  // It is checked after the @ list's own keys, before sending.
  assert.ok(c.indexOf('shouldEditLast(e,') > c.indexOf("if (e.key === 'Escape')"))
  assert.ok(c.indexOf('shouldEditLast(e,') < c.indexOf('shouldSend(e, sendKey)'))
})

test('the box gets its cursor back through focusNonce', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('useEffect(() => { if (focusNonce) taRef.current?.focus() }, [focusNonce])'))
})

test('the chat finds the message from its own messages and my uid, and clears the request when the conversation changes', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('lastEditableMessage(messages, profile?.uid)'))
  assert.ok(s.includes('setEditRequest((r) => ({ id: m.id, n: (r?.n || 0) + 1 }))'))
  assert.ok(s.includes('useEffect(() => { setEditRequest(null) }, [path])'))
  assert.ok(s.includes('onEditLast={editLast}'))
  assert.ok(s.includes('focusNonce={composerFocus}'))
  assert.ok(s.includes('editRequest={editRequest}'))
  assert.ok(s.includes('onEditEnded={() => setComposerFocus((n) => n + 1)}'))
  // Read-only conversations render no box at all, so there is no way to ask.
  assert.ok(s.indexOf('<Composer') > s.indexOf('readOnly ? ('))
})

test('the list opens the edit, and hands the cursor back only for one the key started', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('const keyboardEditRef = useRef(null)'))
  assert.ok(l.includes('keyboardEditRef.current = editRequest.id\n    setEditingId(editRequest.id)'))
  assert.ok(l.includes('if (keyboardEditRef.current !== null) { keyboardEditRef.current = null; onEditEnded?.() }'))
  assert.ok(l.includes('} else if (editingId !== keyboardEditRef.current) {\n      keyboardEditRef.current = null'))
  // The existing rules for who may edit are untouched: only your own, not in read-only, and only with text.
  assert.ok(l.includes('const canEdit = isAuthor && !readOnly'))
  assert.ok(l.includes('canEdit && message.text'))
})
