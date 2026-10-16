// The on-demand loader: it must cache a good load, forget a failed one, and
// recognise "the file is gone" so the UI can say the right thing.
//
//   node --test tests/lazy.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isChunkLoadError, lazyWithPreload, preloadWhenIdle } from '../src/lib/lazy.js'

const Dummy = () => null

test('a good load happens once, however often it is preloaded', async () => {
  let calls = 0
  const C = lazyWithPreload(async () => { calls++; return { default: Dummy } })
  await C.preload(); await C.preload(); await C.preload()
  assert.equal(calls, 1)
})

test('preload hands back the module', async () => {
  const C = lazyWithPreload(async () => ({ default: Dummy }))
  assert.equal((await C.preload()).default, Dummy)
})

test('a FAILED load is forgotten, so the next attempt really asks again', async () => {
  let calls = 0
  const C = lazyWithPreload(async () => {
    calls++
    if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module: /assets/x-abc.js')
    return { default: Dummy }
  })
  await assert.rejects(C.preload(), /Failed to fetch dynamically imported module/)
  assert.equal((await C.preload()).default, Dummy, 'second attempt succeeds')
  assert.equal(calls, 2, 'a cached rejection would have stayed at 1 and failed forever')
})

test('concurrent preloads share one request', async () => {
  let calls = 0
  const C = lazyWithPreload(() => new Promise(r => setTimeout(() => { calls++; r({ default: Dummy }) }, 10)))
  await Promise.all([C.preload(), C.preload(), C.preload()])
  assert.equal(calls, 1)
})

test('the messages each browser uses for a missing file are recognised', () => {
  for (const msg of [
    'Failed to fetch dynamically imported module: https://x/assets/a.js', // Chrome, Edge
    'error loading dynamically imported module: https://x/assets/a.js',   // Firefox
    'Importing a module script failed.',                                   // Safari
    'Loading chunk 12 failed.',                                            // webpack-style
    'Loading CSS chunk 3 failed',
  ]) assert.equal(isChunkLoadError(new TypeError(msg)), true, msg)
  const named = new Error('x'); named.name = 'ChunkLoadError'
  assert.equal(isChunkLoadError(named), true)
})

test('an ordinary crash is NOT mistaken for a missing file', () => {
  for (const e of [new Error('x is not a function'), new TypeError("Cannot read properties of undefined (reading 'map')"), null, undefined]) {
    assert.equal(isChunkLoadError(e), false, String(e))
  }
})

test('preloading waits, then loads, and one failure does not stop the others', async () => {
  const loaded = []
  const ok = lazyWithPreload(async () => { loaded.push('ok'); return { default: Dummy } })
  const bad = lazyWithPreload(async () => { loaded.push('bad'); throw new Error('offline') })
  const after = lazyWithPreload(async () => { loaded.push('after'); return { default: Dummy } })
  const cancel = preloadWhenIdle([bad, ok, after], { after: 120 })
  await new Promise(r => setTimeout(r, 40)) // part-way through the wait
  assert.deepEqual(loaded, [], 'nothing yet: first paint and the app\'s own data come first')
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(loaded.sort(), ['after', 'bad', 'ok'], 'then all of them, even though one failed')
  assert.equal(typeof cancel, 'function')
})

test('a preload can be cancelled before it starts', async () => {
  let calls = 0
  const C = lazyWithPreload(async () => { calls++; return { default: Dummy } })
  const cancel = preloadWhenIdle([C], { after: 20 })
  cancel()
  await new Promise(r => setTimeout(r, 60))
  assert.equal(calls, 0)
})
