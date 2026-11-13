// Forwarding a message: what is copied, who it says it came from, where it can go, and that the
// button, the dialog and the send are wired together.
//
//   node --test tests/forward.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canForward, destinationPath, forwardPayload, forwardPreview, forwardTargets, forwardedFromOf } from '../src/lib/forward.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const dmId = (a, b) => [a, b].sort().join('_')

// ---------- what can be forwarded ----------

test('a message with text, or a picture, can be forwarded; an empty one cannot', () => {
  assert.equal(canForward({ text: 'hi' }), true)
  assert.equal(canForward({ text: '', imageURL: 'data:image/png;base64,AA' }), true)
  assert.equal(canForward({ text: '  ', imageURL: null }), false)
  for (const m of [null, undefined, {}, { text: 5 }, { imageURL: '' }, { imageURL: 7 }]) assert.equal(canForward(m), false, JSON.stringify(m))
})

// ---------- what is sent ----------

const users = { u1: { name: 'Ana Reyes' }, meuid1: { name: 'Me Myself' } }
const original = {
  id: 'm1', author: { uid: 'u1', name: 'Old Name' }, text: 'see you at 3, <@meuid1>',
  reactions: { '👍': ['u2'] }, pinned: true, replyTo: { messageId: 'x' }, mentionedUids: ['meuid1'], editedAt: 1,
}

test('the text and who wrote it are copied, nothing else of the original', () => {
  const p = forwardPayload(original, users)
  assert.deepEqual(Object.keys(p).sort(), ['forwardedFrom', 'imageMeta', 'imageURL', 'text'])
  assert.equal(p.text, 'see you at 3, @Me Myself')
  assert.deepEqual(p.forwardedFrom, { uid: 'u1', name: 'Ana Reyes' })
  assert.equal(p.imageURL, null)
  assert.equal(p.imageMeta, null)
})

test('a mention is written as a name, so the forward cannot ping or tint anyone', () => {
  const p = forwardPayload(original, users)
  assert.ok(!p.text.includes('<@'))
  assert.ok(!('mentionedUids' in p))
  const unknown = forwardPayload({ ...original, text: 'hi <@ghost99>' }, users)
  assert.equal(unknown.text, 'hi @Unknown')
})

test('the writer is named as the directory knows them now, else as the message said', () => {
  assert.equal(forwardPayload(original, users).forwardedFrom.name, 'Ana Reyes')
  assert.equal(forwardPayload(original, {}).forwardedFrom.name, 'Old Name')
  assert.equal(forwardPayload({ text: 'x', author: {} }, {}).forwardedFrom.name, 'Unknown')
  assert.equal(forwardPayload({ text: 'x' }, {}).forwardedFrom.uid, null)
})

test('a picture is copied with its details', () => {
  const m = { text: '', author: { uid: 'u1' }, imageURL: 'data:image/png;base64,AA', imageMeta: { width: 2, height: 3 } }
  const p = forwardPayload(m, users)
  assert.equal(p.imageURL, m.imageURL)
  assert.deepEqual(p.imageMeta, { width: 2, height: 3 })
  assert.equal(p.text, '')
  assert.equal(forwardPayload({ ...m, imageMeta: 'junk' }, users).imageMeta, null)
  assert.equal(forwardPayload({ ...m, imageMeta: [1] }, users).imageMeta?.length, 1, 'an object, even an array, is passed as it is')
})

test('forwarding a forward keeps the ORIGINAL writer, not the person who passed it on', () => {
  const passedOn = { ...original, author: { uid: 'u3', name: 'Cara' }, forwardedFrom: { uid: 'u1', name: 'Ana Reyes' } }
  assert.deepEqual(forwardPayload(passedOn, { ...users, u3: { name: 'Cara Diaz' } }).forwardedFrom, { uid: 'u1', name: 'Ana Reyes' })
})

test('nothing to forward gives nothing', () => {
  assert.equal(forwardPayload({ text: '' }, users), null)
  assert.equal(forwardPayload(null, users), null)
})

test('the original is not changed', () => {
  const copy = JSON.parse(JSON.stringify(original))
  forwardPayload(original, users)
  assert.deepEqual(original, copy)
})

// ---------- reading who it came from (anybody can write anything) ----------

test('forwardedFromOf cleans what it reads', () => {
  assert.deepEqual(forwardedFromOf({ forwardedFrom: { uid: 'u1', name: 'Ana' } }), { uid: 'u1', name: 'Ana' })
  assert.deepEqual(forwardedFromOf({ forwardedFrom: { name: 'Ana' } }), { uid: null, name: 'Ana' })
  assert.deepEqual(forwardedFromOf({ forwardedFrom: { uid: 5, name: 'Ana' } }), { uid: null, name: 'Ana' })
  assert.equal(forwardedFromOf({ forwardedFrom: { name: 'x'.repeat(500) } }).name.length, 60)
  assert.equal(forwardedFromOf({ forwardedFrom: { name: 'a\nb\u0000c' } }).name, 'a b c')
})

test('what is not a usable "forwarded from" shows nothing', () => {
  for (const f of [null, undefined, '', 'Ana', 5, [], ['Ana'], {}, { name: '' }, { name: '   ' }, { name: 7 }, { name: null }]) {
    assert.equal(forwardedFromOf({ forwardedFrom: f }), null, JSON.stringify(f))
  }
  assert.equal(forwardedFromOf(null), null)
  assert.equal(forwardedFromOf({}), null)
})

test('a text-direction trick in the name does not survive', () => {
  const rlo = String.fromCodePoint(0x202E)
  const out = forwardedFromOf({ forwardedFrom: { name: 'Ana' + rlo + 'evil' } })
  assert.ok(!out.name.includes(rlo))
})

// ---------- the line in the dialog ----------

test('the preview is one line, cut at the limit, or says it is an image', () => {
  assert.equal(forwardPreview({ text: 'hello   there\nfriend' }), 'hello there friend')
  assert.equal(forwardPreview({ text: 'x'.repeat(200) }, 10), 'x'.repeat(10) + '…')
  assert.equal(forwardPreview({ text: 'x'.repeat(10) }, 10), 'x'.repeat(10), 'exactly the limit is not cut')
  assert.equal(forwardPreview({ text: '', imageURL: 'data:x' }), '[image]')
  assert.equal(forwardPreview({}), '[image]')
  assert.equal(forwardPreview({ text: 'hi <@abc123>' }, 160, { abc123: { name: 'Ana' } }), 'hi @Ana', 'a mention reads as it will be sent')
  assert.equal(forwardPreview({ text: 'hi <@abc123>' }), 'hi @Unknown')
  assert.equal(Array.from(forwardPreview({ text: '😀'.repeat(20) }, 5)).length, 6, 'an emoji is one character and is never split')
})

// ---------- where it can go ----------

const dmT = { id: 'dm:u1', kind: 'dm', label: 'Ana', path: '/dms/u1', user: { id: 'u1' } }
const chT = { id: 'ch:G1:C1', kind: 'channel', label: 'general', path: '/g/G1/c/C1' }
const voiceT = { id: 'ch:G1:V1', kind: 'voice', label: 'standup', path: '/g/G1/c/V1' }
const notesT = { id: 'notes', kind: 'notes', label: 'My Notes', path: '/me/notes' }

test('each kind of destination has its own collection', () => {
  assert.equal(destinationPath(dmT, 'me', dmId), 'dms/me_u1/messages')
  assert.equal(destinationPath(chT, 'me', dmId), 'groups/G1/channels/C1/messages')
  assert.equal(destinationPath(notesT, 'me', dmId), 'users/me/notes')
})

test('a voice room, an unknown kind, or something unusable has none', () => {
  assert.equal(destinationPath(voiceT, 'me', dmId), null)
  assert.equal(destinationPath({ kind: 'other' }, 'me', dmId), null)
  assert.equal(destinationPath({ kind: 'dm' }, 'me', dmId), null)
  assert.equal(destinationPath({ kind: 'dm', user: {} }, 'me', dmId), null)
  assert.equal(destinationPath({ kind: 'channel', path: '/g/G1' }, 'me', dmId), null)
  assert.equal(destinationPath({ kind: 'channel', path: '/g/G 1/c/C1' }, 'me', dmId), null)
  assert.equal(destinationPath({ kind: 'channel', path: '/g/G1/c/C1/extra' }, 'me', dmId), null)
  assert.equal(destinationPath({ kind: 'channel' }, 'me', dmId), null)
  assert.equal(destinationPath(null, 'me', dmId), null)
  assert.equal(destinationPath(chT, null, dmId), null)
  assert.equal(destinationPath(chT, '', dmId), null)
})

test('the picker offers people, text channels and notes, not voice rooms, and not where the message already is', () => {
  const all = [notesT, dmT, chT, voiceT]
  assert.deepEqual(forwardTargets(all, { meUid: 'me', currentPath: 'x', dmId }).map((t) => t.id), ['notes', 'dm:u1', 'ch:G1:C1'])
  assert.deepEqual(forwardTargets(all, { meUid: 'me', currentPath: 'groups/G1/channels/C1/messages', dmId }).map((t) => t.id), ['notes', 'dm:u1'])
  assert.deepEqual(forwardTargets(all, { meUid: 'me', currentPath: 'dms/me_u1/messages', dmId }).map((t) => t.id), ['notes', 'ch:G1:C1'])
  assert.deepEqual(forwardTargets(all, { meUid: 'me', currentPath: 'users/me/notes', dmId }).map((t) => t.id), ['dm:u1', 'ch:G1:C1'])
  assert.deepEqual(forwardTargets(undefined, { meUid: 'me', currentPath: 'x', dmId }), [])
  assert.deepEqual(forwardTargets(all, { meUid: null, currentPath: 'x', dmId }), [])
})

// ---------- wired together ----------

test('sending stores who wrote it, and a normal message stores none', () => {
  const d = read('src/lib/db.js')
  assert.ok(d.includes('replyTo = null, forwardedFrom = null }) {'))
  assert.ok(d.includes("forwardedFrom: forwardedFrom ? { uid: forwardedFrom.uid ?? null, name: String(forwardedFrom.name ?? '') } : null,"))
})

test('every message that can be forwarded gets a Forward button, never in a read-only view', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes("import { canForward, forwardedFromOf } from '../lib/forward'"))
  assert.ok(l.includes('{onForward && canForward(message) && ('))
  assert.ok(l.includes('onClick={() => onForward(message)}'))
  assert.ok(l.includes('title="Forward"'))
  assert.equal(l.split('onForward={onForward}').length - 1, 2, 'handed through the group to every row')
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('onForward={readOnly ? null : setForwarding}'))
})

test('a forwarded message says who wrote it, in text, using the cleaned name', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes('{forwarded && ('))
  assert.ok(l.includes('const forwarded = forwardedFromOf(message)'))
  assert.ok(l.includes("{savedNote ? 'Saved from' : 'Forwarded from'} <span className=\"text-ink-muted\">{forwarded.name}</span>"))
})

test('the dialog is loaded on demand, opened from the chat, closed with the conversation', () => {
  const p = read('src/lib/lazyParts.js')
  assert.ok(p.includes("export const ForwardDialog = lazyWithPreload(() => import('../components/ForwardDialog'))"))
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('<ForwardDialog message={forwarding} currentPath={path} onClose={() => setForwarding(null)} />'))
  assert.ok(s.includes('setReplyingTo(null)\n    setForwarding(null)'))
})

test('the dialog sends a new message from you through the normal send, to a DM only after making sure it exists', () => {
  const d = read('src/components/ForwardDialog.jsx')
  assert.ok(d.includes('forwardPayload(message, byId)'))
  assert.ok(d.includes('{forwardPreview(message, 160, byId)}'))
  assert.ok(d.includes('destinationPath(target, profile?.id, dmConvoId)'))
  assert.ok(d.includes("if (target.kind === 'dm') await ensureDmConvo(profile, target.user)"))
  assert.ok(d.includes('await sendMessage(path, { ...payload, author: profile })'))
  assert.ok(d.indexOf('ensureDmConvo(profile, target.user)') < d.indexOf('await sendMessage(path'))
  // a second click while one is in flight, or after it was sent, does nothing
  assert.ok(d.includes('if (!target || busy || sentTo) return'))
  assert.ok(d.includes('forwardTargets(buildTargets('))
  assert.ok(d.includes('{ meUid: profile?.id, currentPath, dmId: dmConvoId }'), 'the conversation you are in is left out')
  assert.ok(d.includes('rankTargets(targets, query, 20)'))
  // after a failure it can be tried again
  assert.ok(d.includes('setBusy(false)\n    }\n  }'))
  assert.ok(d.includes("setError(\"Couldn't forward it. Check your connection and try again.\")"))
})

test('the dialog says where it went, then closes, and cannot be closed by a click while sending', () => {
  const d = read('src/components/ForwardDialog.jsx')
  assert.ok(d.includes('Forwarded to {sentTo}.'))
  assert.ok(d.includes('setTimeout(onClose, 1100)'))
  assert.ok(d.includes('onClose={busy && !sentTo ? undefined : onClose}'))
  assert.ok(d.includes('useEffect(() => () => clearTimeout(closeTimer.current), [])'))
})
