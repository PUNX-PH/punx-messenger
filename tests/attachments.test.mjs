// Several pictures at once: what is accepted, how they are sent, and that the pieces are wired together.
//
//   node --test tests/attachments.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  MAX_FILES, MAX_BYTES, isImageFile, addAttachments, dragHasFiles, filesOf, pastedImages,
  sendAttachments, remainingAfter, uploadingText,
} from '../src/lib/attachments.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const pic = (name, size = 1000, type = 'image/png', lastModified = 1) => ({ name, size, type, lastModified })
const names = (r) => r.files.map(f => f.name)

// ---------- what is accepted ----------

test('pictures are added in the order given, after any already waiting', () => {
  const r = addAttachments([pic('a')], [pic('b'), pic('c')])
  assert.deepEqual(names(r), ['a', 'b', 'c'])
  assert.equal(r.problem, null)
})

test('nothing, or nothing usable, changes nothing', () => {
  assert.deepEqual(addAttachments(null, null), { files: [], problem: null })
  assert.deepEqual(addAttachments(undefined, []), { files: [], problem: null })
  const r = addAttachments([pic('a')], [null, undefined])
  assert.deepEqual(names(r), ['a'])
  assert.equal(r.problem, null)
})

test('the list given is not changed: a new one comes back', () => {
  const cur = [pic('a')]
  const r = addAttachments(cur, [pic('b')])
  assert.equal(cur.length, 1)
  assert.notEqual(r.files, cur)
})

test('only images: anything else is left out and said so, with the images kept', () => {
  const r = addAttachments([], [pic('a'), pic('notes.pdf', 10, 'application/pdf'), pic('b'), pic('x', 10, '')])
  assert.deepEqual(names(r), ['a', 'b'])
  assert.equal(r.problem, '2 files are not images (only images for now).')
  assert.equal(addAttachments([], [pic('n', 10, 'text/plain')]).problem, '1 file is not an image (only images for now).')
})

test('a file with no type at all is not an image', () => {
  assert.equal(isImageFile({ name: 'x' }), false)
  assert.equal(isImageFile(null), false)
  assert.equal(isImageFile({ type: 'image/svg+xml' }), true)
  assert.equal(isImageFile({ type: 'video/mp4' }), false)
})

test('each picture may be 10 MB, not a byte more', () => {
  assert.equal(MAX_BYTES, 10 * 1024 * 1024)
  assert.deepEqual(names(addAttachments([], [pic('ok', MAX_BYTES)])), ['ok'])
  const r = addAttachments([], [pic('big', MAX_BYTES + 1), pic('ok')])
  assert.deepEqual(names(r), ['ok'])
  assert.equal(r.problem, '1 image is over 10 MB.')
  assert.equal(addAttachments([], [pic('a', MAX_BYTES + 1), pic('b', MAX_BYTES + 5)]).problem, '2 images are over 10 MB.')
})

test('the same file chosen twice is one; a different file with the same name is not', () => {
  const r = addAttachments([pic('a', 1000, 'image/png', 5)], [pic('a', 1000, 'image/png', 5)])
  assert.equal(r.files.length, 1)
  assert.equal(r.problem, null, 'not an error: it is just already there')
  assert.equal(addAttachments([pic('a', 1000, 'image/png', 5)], [pic('a', 1001, 'image/png', 5)]).files.length, 2, 'other size')
  assert.equal(addAttachments([pic('a', 1000, 'image/png', 5)], [pic('a', 1000, 'image/png', 6)]).files.length, 2, 'other time')
  assert.equal(addAttachments([pic('a', 1000, 'image/png', 5)], [pic('b', 1000, 'image/png', 5)]).files.length, 2, 'other name')
  assert.equal(addAttachments([], [pic('a'), pic('a')]).files.length, 1, 'twice in the same drop')
})

test('at most ten at a time: the first ten are kept, the rest are said to be left out', () => {
  assert.equal(MAX_FILES, 10)
  const many = Array.from({ length: 13 }, (_, i) => pic(`p${i}`, 100 + i))
  const r = addAttachments([], many)
  assert.equal(r.files.length, 10)
  assert.deepEqual(names(r), many.slice(0, 10).map(f => f.name))
  assert.equal(r.problem, '3 images left out: at most 10 at a time.')
  assert.equal(addAttachments([], many.slice(0, 11)).problem, '1 image left out: at most 10 at a time.')
  assert.equal(addAttachments([], many.slice(0, 10)).problem, null, 'ten exactly is fine')
})

test('what is already waiting counts toward the ten, and is never dropped to make room', () => {
  const cur = Array.from({ length: 9 }, (_, i) => pic(`c${i}`, 100 + i))
  const r = addAttachments(cur, [pic('n1'), pic('n2')])
  assert.equal(r.files.length, 10)
  assert.deepEqual(names(r).slice(0, 9), cur.map(f => f.name))
  assert.equal(r.files[9].name, 'n1')
  assert.equal(r.problem, '1 image left out: at most 10 at a time.')
  const full = addAttachments(r.files, [pic('late')])
  assert.deepEqual(names(full), names(r))
})

test('a drop with several kinds of trouble says each, once', () => {
  const cur = Array.from({ length: 10 }, (_, i) => pic(`c${i}`, 100 + i))
  const r = addAttachments(cur, [pic('doc', 5, 'application/pdf'), pic('big', MAX_BYTES + 1), pic('extra')])
  assert.equal(r.files.length, 10)
  assert.equal(r.problem, '1 file is not an image (only images for now); 1 image is over 10 MB; 1 image left out: at most 10 at a time.')
})

test('a bad file does not use up a place', () => {
  const cur = Array.from({ length: 9 }, (_, i) => pic(`c${i}`, 100 + i))
  const r = addAttachments(cur, [pic('doc', 5, 'application/pdf'), pic('big', MAX_BYTES + 1), pic('fits')])
  assert.equal(r.files.length, 10)
  assert.equal(r.files[9].name, 'fits')
})

// ---------- drags and the clipboard ----------

test('a drag carries files when its types say so, and not for dragged text or links', () => {
  assert.equal(dragHasFiles({ types: ['Files'] }), true)
  assert.equal(dragHasFiles({ types: ['text/plain', 'Files'] }), true)
  assert.equal(dragHasFiles({ types: ['text/plain'] }), false)
  assert.equal(dragHasFiles({ types: ['text/uri-list', 'text/html'] }), false)
  assert.equal(dragHasFiles({ types: [] }), false)
  assert.equal(dragHasFiles({}), false)
  assert.equal(dragHasFiles(null), false)
  assert.equal(dragHasFiles({ types: { 0: 'Files', length: 1 } }), true, 'array-like, as DOMStringList is')
})

test('the files in a drop, as an array', () => {
  const a = pic('a'), b = pic('b')
  assert.deepEqual(filesOf({ files: [a, b] }), [a, b])
  assert.deepEqual(filesOf({ files: { 0: a, 1: b, length: 2 } }), [a, b])
  assert.deepEqual(filesOf({}), [])
  assert.deepEqual(filesOf(null), [])
})

test('from the clipboard: every picture, but not the text', () => {
  const f1 = pic('shot1'), f2 = pic('shot2')
  const items = [
    { kind: 'string', type: 'text/plain', getAsFile: () => null },
    { kind: 'file', type: 'image/png', getAsFile: () => f1 },
    { kind: 'file', type: 'application/pdf', getAsFile: () => pic('x', 1, 'application/pdf') },
    { kind: 'file', type: 'image/jpeg', getAsFile: () => f2 },
    { kind: 'file', type: 'image/gif', getAsFile: () => null },
  ]
  assert.deepEqual(pastedImages({ items }), [f1, f2])
  assert.deepEqual(pastedImages({ items: { 0: items[1], length: 1 } }), [f1], 'array-like')
  assert.deepEqual(pastedImages({ items: [{ kind: 'string', type: 'image/png', getAsFile: () => f1 }] }), [], 'a string is text even if it says image')
  assert.deepEqual(pastedImages({}), [])
  assert.deepEqual(pastedImages(null), [])
})

// ---------- sending ----------

test('nothing attached: one message, the text, no follow-up', async () => {
  const calls = []
  const r = await sendAttachments({ text: 'hi', files: [], send: async (m) => { calls.push(m) } })
  assert.deepEqual(calls, [{ text: 'hi', imageFile: null, followUp: false }])
  assert.deepEqual(r, { sent: 1, error: null })
  assert.deepEqual((await sendAttachments({ text: 'x', send: async () => {} })), { sent: 1, error: null }, 'no list at all')
})

test('one message per picture, in order; the text is on the first only', async () => {
  const calls = []
  const files = [pic('a'), pic('b'), pic('c')]
  const r = await sendAttachments({ text: 'look', files, send: async (m) => { calls.push(m) } })
  assert.deepEqual(calls, [
    { text: 'look', imageFile: files[0], followUp: false },
    { text: '', imageFile: files[1], followUp: true },
    { text: '', imageFile: files[2], followUp: true },
  ])
  assert.deepEqual(r, { sent: 3, error: null })
})

test('a picture alone is one message with no follow-up', async () => {
  const calls = []
  await sendAttachments({ text: '', files: [pic('a')], send: async (m) => { calls.push(m) } })
  assert.deepEqual(calls.map(c => c.followUp), [false])
})

test('one at a time: the next does not start until the last is done', async () => {
  const log = []
  let release
  const gate = new Promise(res => { release = res })
  const files = [pic('a'), pic('b')]
  const done = sendAttachments({
    text: '', files,
    send: async (m) => { log.push('start ' + m.imageFile.name); if (m.imageFile.name === 'a') await gate; log.push('end ' + m.imageFile.name) },
  })
  await new Promise(r => setTimeout(r, 20))
  assert.deepEqual(log, ['start a'], 'b waits for a')
  release()
  await done
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b'])
})

test('a failure stops there and says how far it got, with the error', async () => {
  const boom = new Error('network')
  const calls = []
  const files = [pic('a'), pic('b'), pic('c'), pic('d')]
  const r = await sendAttachments({
    text: 't', files,
    send: async (m) => { calls.push(m.imageFile.name); if (m.imageFile.name === 'c') throw boom },
  })
  assert.deepEqual(calls, ['a', 'b', 'c'], 'd is not tried')
  assert.equal(r.sent, 2)
  assert.equal(r.error, boom)
  assert.deepEqual(remainingAfter(files, r.sent).map(f => f.name), ['c', 'd'])
})

test('the first failing means nothing went, and everything is kept', async () => {
  const boom = new Error('x')
  const files = [pic('a'), pic('b')]
  const r = await sendAttachments({ text: 't', files, send: async () => { throw boom } })
  assert.deepEqual(r, { sent: 0, error: boom })
  assert.deepEqual(remainingAfter(files, 0), files)
})

test('a text-only message failing is reported the same way', async () => {
  const boom = new Error('x')
  assert.deepEqual(await sendAttachments({ text: 't', files: [], send: async () => { throw boom } }), { sent: 0, error: boom })
})

test('progress is announced before each picture goes', async () => {
  const seen = []
  await sendAttachments({ text: '', files: [pic('a'), pic('b'), pic('c')], send: async () => {}, onProgress: (d, t) => seen.push([d, t]) })
  assert.deepEqual(seen, [[0, 3], [1, 3], [2, 3]])
  const none = []
  await sendAttachments({ text: 'x', files: [], send: async () => {}, onProgress: (d, t) => none.push([d, t]) })
  assert.deepEqual(none, [])
})

test('what is left after a partial send; nonsense counts keep everything or nothing sensibly', () => {
  const files = [pic('a'), pic('b'), pic('c')]
  assert.deepEqual(remainingAfter(files, 0).map(f => f.name), ['a', 'b', 'c'])
  assert.deepEqual(remainingAfter(files, 1).map(f => f.name), ['b', 'c'])
  assert.deepEqual(remainingAfter(files, 3), [])
  assert.deepEqual(remainingAfter(files, 9), [])
  assert.deepEqual(remainingAfter(files, -2).map(f => f.name), ['a', 'b', 'c'])
  assert.deepEqual(remainingAfter(null, 1), [])
})

test('the box says which picture is going', () => {
  assert.equal(uploadingText(0, 1), 'Uploading…')
  assert.equal(uploadingText(0, 0), 'Uploading…')
  assert.equal(uploadingText(0, 5), 'Uploading 1 of 5…')
  assert.equal(uploadingText(4, 5), 'Uploading 5 of 5…')
  assert.equal(uploadingText(9, 5), 'Uploading 5 of 5…', 'never past the last')
})

// ---------- wired together ----------

test('the box sends through sendAttachments and keeps what did not go', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes("from '../lib/attachments'"))
  assert.ok(c.includes('await sendAttachments({'))
  assert.ok(c.includes('send: onSend,'))
  assert.ok(c.includes('if (sent > 0) drafts.clear(sentKey)'))
  assert.ok(c.includes('if (sent > 0) { setText(\'\'); setFiles(remainingAfter(sentFiles, sent)) }'))
  // Success empties the tray.
  assert.ok(c.includes("setText(''); setFiles([]); setEmojiSug(null)"))
  // And switching conversation does too: the pictures belong to the one they were chosen in.
  assert.ok(c.includes('setText(drafts.get(draftKey))\n    setFiles([])'))
})

test('every way of adding pictures goes through one function that applies the limits', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('const r = addAttachments(filesRef.current, incoming)'))
  assert.ok(c.includes('if (sending || disabled || voice) return'), 'not while one is going out, or recording')
  assert.ok(c.includes('onChange={(e) => { attach(Array.from(e.target.files || [])); e.target.value = \'\' }}'), 'the picker takes several and can pick the same again')
  assert.ok(c.includes('multiple\n'))
  assert.ok(c.includes('const pics = pastedImages(e.clipboardData)'))
  assert.ok(c.includes('if (pics.length) { e.preventDefault(); attach(pics) }'), 'pasted text is left alone')
  assert.ok(c.includes('attachRef.current(filesOf(e.dataTransfer))'))
  assert.ok(!c.includes('setFile('), 'no single-file state left')
})

test('the drop zone is the whole conversation, only reacts to files, and always takes its cue down', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('const el = dropZoneRef?.current'))
  assert.equal(c.split('if (!dragHasFiles(e.dataTransfer)) return').length - 1, 4, 'all four drag events ignore text and links')
  assert.ok(c.includes("e.dataTransfer.dropEffect = 'copy'"))
  assert.ok(c.includes('depth++; setDragging(true)'))
  assert.ok(c.includes('depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false)'))
  assert.ok(c.includes("window.addEventListener('dragend', reset)"))
  assert.ok(c.includes("window.addEventListener('drop', reset)"))
  assert.ok(c.includes("window.removeEventListener('dragend', reset)"))
  assert.ok(c.includes("window.removeEventListener('drop', reset)"))
  for (const ev of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    assert.ok(c.includes(`el.addEventListener('${ev}'`), ev)
    assert.ok(c.includes(`el.removeEventListener('${ev}'`), ev + ' removed')
  }
  assert.ok(c.includes('}, [dropZoneRef, disabled])'))
  // The cue is drawn over the conversation and never catches the pointer, or the drag would lose the zone.
  assert.ok(c.includes('{dragging && dropZoneRef?.current && createPortal('))
  assert.ok(c.includes('pointer-events-none absolute inset-0'))
  assert.ok(c.includes('dropZoneRef.current,\n      )}'))
})

test('the cue comes down on a drop, and when the zone goes away mid-drag', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('e.preventDefault(); reset(); attachRef.current(filesOf(e.dataTransfer))'), 'a drop takes the cue down at once')
  assert.ok(c.includes("window.removeEventListener('drop', reset)\n      reset()"), 'cleanup takes it down too')
})

test('the box shows the progress it is given', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('placeholder={sending ? uploadingText(progress.done, progress.total) : placeholder}'))
  assert.ok(c.includes('onProgress: (done, total) => setProgress({ done, total }),'))
  assert.ok(c.includes('setProgress({ done: 0, total: files.length })'))
})

test('the old single drop on the box is gone, so a drop is not handled twice', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(!c.includes('onDrop={'))
  assert.ok(!c.includes('onDragOver={'))
})

test('the tray shows each picture with a way to remove it, and is released with them', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('<AttachmentTray files={files} busy={sending} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />'))
  const t = read('src/components/AttachmentTray.jsx')
  assert.ok(t.includes('files.map(f => URL.createObjectURL(f))'))
  assert.ok(t.includes('urls.forEach(u => URL.revokeObjectURL(u))'))
  assert.ok(t.includes('disabled={busy}'))
  assert.ok(t.includes('onClick={() => onRemove(i)}'))
})

test('only the first picture of a go quotes the message being replied to', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('replyTo: followUp ? null : replyingTo'))
  assert.ok(s.includes('<main ref={surfaceRef} className='))
  assert.ok(s.includes('dropZoneRef={surfaceRef}'))
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('dropZoneRef = null,'))
})

test('the box is not empty, and the mic stays away, while pictures wait', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('if (!text.trim() && files.length === 0) return'))
  assert.ok(c.includes('disabled={(!text.trim() && files.length === 0) || sending || disabled}'))
  assert.ok(c.includes('hasFile: files.length > 0'))
})
