// Per-conversation drafts: what you typed comes back when you return, and never
// follows you into another conversation.
//
//   node --test tests/drafts.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDraftStore } from '../src/lib/drafts.js'

const memory = (initial = {}) => {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    has: (k) => m.has(k),
  }
}
const store = (opts = {}) => createDraftStore({ storage: memory(), delay: 0, ...opts })

test('a conversation nobody typed in has no draft', () => {
  assert.equal(store().get('me:dms/a'), '')
})

test('what you type is kept and comes back', () => {
  const s = store()
  s.set('me:dms/a', 'half a thought')
  assert.equal(s.get('me:dms/a'), 'half a thought')
})

test('a draft belongs to its conversation and does not leak into another', () => {
  const s = store()
  s.set('me:groups/g/channels/A', 'meant for A')
  assert.equal(s.get('me:groups/g/channels/B'), '')
  s.set('me:groups/g/channels/B', 'meant for B')
  assert.equal(s.get('me:groups/g/channels/A'), 'meant for A')
  assert.equal(s.get('me:groups/g/channels/B'), 'meant for B')
})

test('the same conversation for two different accounts is two different drafts', () => {
  const s = store()
  s.set('ana:dms/x', 'ana wrote this')
  assert.equal(s.get('ben:dms/x'), '')
})

test('emptying the box removes the draft, and so does only spaces', () => {
  const s = store()
  s.set('k', 'text')
  s.set('k', '')
  assert.equal(s.get('k'), '')
  s.set('k', 'text')
  s.set('k', '   \n ')
  assert.equal(s.get('k'), '')
})

test('clear removes one draft and leaves the others', () => {
  const s = store()
  s.set('a', '1'); s.set('b', '2')
  s.clear('a')
  assert.equal(s.get('a'), '')
  assert.equal(s.get('b'), '2')
})

test('no key means no draft and no error', () => {
  const s = store()
  assert.equal(s.get(undefined), '')
  assert.equal(s.get(null), '')
  assert.doesNotThrow(() => { s.set(undefined, 'x'); s.clear(undefined) })
})

test('only the 50 most recently touched drafts are kept', () => {
  const s = store()
  for (let i = 1; i <= 50; i++) s.set(`k${i}`, `text ${i}`)
  s.set('k1', 'k1 touched again')       // k1 is now the newest, so k2 is the oldest
  s.set('k51', 'one more')
  assert.equal(s.get('k2'), '', 'the oldest-touched was dropped')
  assert.equal(s.get('k1'), 'k1 touched again', 'a touched draft survives')
  assert.equal(s.get('k51'), 'one more')
  assert.equal(s.get('k50'), 'text 50')
})

test('one runaway paste cannot fill storage', () => {
  const s = store()
  s.set('k', 'x'.repeat(100_000))
  assert.equal(s.get('k').length, 20_000)
})

test('drafts survive a reload (a new store reading the same tab storage)', () => {
  const storage = memory()
  const a = createDraftStore({ storage, delay: 0 })
  a.set('me:dms/a', 'keep me')
  const b = createDraftStore({ storage, delay: 0 })
  assert.equal(b.get('me:dms/a'), 'keep me')
})

test('storage is written after a pause in typing, and on flush', async () => {
  const storage = memory()
  const s = createDraftStore({ storage, delay: 20 })
  s.set('k', 'a'); s.set('k', 'ab'); s.set('k', 'abc')
  assert.equal(storage.has('punx.drafts'), false, 'not written on every keystroke')
  s.flush()
  assert.equal(JSON.parse(storage.getItem('punx.drafts')).k, 'abc')
  s.set('k', 'abcd')
  await new Promise(r => setTimeout(r, 60))
  assert.equal(JSON.parse(storage.getItem('punx.drafts')).k, 'abcd')
})

test('signing out wipes every draft, at once, from storage too', () => {
  const storage = memory()
  const s = createDraftStore({ storage, delay: 0 })
  s.set('ana:a', '1'); s.set('ana:b', '2')
  s.clearAll()
  assert.equal(s.get('ana:a'), '')
  assert.equal(storage.has('punx.drafts'), false)
  assert.equal(createDraftStore({ storage, delay: 0 }).get('ana:b'), '')
})

test('damaged storage starts empty instead of breaking the composer', () => {
  for (const raw of ['not json', '[1,2]', '"x"', '123', 'null', '{"a":5,"b":"","c":"   ","d":"ok"}']) {
    const s = createDraftStore({ storage: memory({ 'punx.drafts': raw }), delay: 0 })
    assert.equal(s.get('a'), '', raw)
    assert.equal(s.get('b'), '', raw)
    assert.equal(s.get('c'), '', raw)
  }
  const mixed = createDraftStore({ storage: memory({ 'punx.drafts': '{"a":5,"d":"ok"}' }), delay: 0 })
  assert.equal(mixed.get('d'), 'ok')
  assert.equal(mixed.get('a'), '', 'a non-text entry is ignored')
})

test('storage that throws (private mode, full) never breaks typing', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('denied') } }
  const s = createDraftStore({ storage: broken, delay: 0 })
  assert.doesNotThrow(() => s.set('k', 'still works'))
  assert.equal(s.get('k'), 'still works', 'kept for this page at least')
  assert.doesNotThrow(() => s.clearAll())
})

test('no storage at all still works for the life of the page', () => {
  const s = createDraftStore({ storage: null, delay: 0 })
  s.set('k', 'v')
  assert.equal(s.get('k'), 'v')
})

test('a draft that was cleared (a message was sent) does not come back after a reload', () => {
  const storage = memory()
  const a = createDraftStore({ storage, delay: 0 })
  a.set('me:dms/a', 'about to be sent')
  a.set('me:dms/b', 'still unsent')
  a.clear('me:dms/a')                       // sending clears the draft
  const afterReload = createDraftStore({ storage, delay: 0 })
  assert.equal(afterReload.get('me:dms/a'), '', 'the sent message must not reappear in the box')
  assert.equal(afterReload.get('me:dms/b'), 'still unsent')
})

test('emptying the box also survives a reload', () => {
  const storage = memory()
  const a = createDraftStore({ storage, delay: 0 })
  a.set('k', 'text')
  a.set('k', '')
  assert.equal(createDraftStore({ storage, delay: 0 }).get('k'), '')
})

test('a stored list is not mistaken for drafts', () => {
  const s = createDraftStore({ storage: memory({ 'punx.drafts': '["looks like a draft"]' }), delay: 0 })
  assert.equal(s.get('0'), '')
})
