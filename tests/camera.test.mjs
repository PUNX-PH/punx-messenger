// The camera that can be blurred and un-blurred while it runs, tested with a fake
// processor: no camera, no GPU.
//
//   node --test tests/camera.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openCamera, loadBlurPref, saveBlurPref } from '../src/lib/camera.js'

const track = (name) => ({ name, stopped: false, stop() { this.stopped = true } })

// A processor factory that records what it made.
function factory({ failWith, delay = 0 } = {}) {
  const made = []
  const create = async (raw) => {
    if (delay) await new Promise(r => setTimeout(r, delay))
    if (failWith) throw failWith
    const p = { raw, track: track(`blurred-${made.length}`), stopped: false, stop() { this.stopped = true; this.track.stop() } }
    made.push(p)
    return p
  }
  return { create, made }
}

test('starts as the plain camera', () => {
  const raw = track('raw')
  const cam = openCamera(raw, { createProcessor: factory().create })
  assert.equal(cam.track, raw)
  assert.equal(cam.blurred, false)
})

test('blur on swaps the track to the processed one, off swaps it back', async () => {
  const raw = track('raw')
  const f = factory()
  const cam = openCamera(raw, { createProcessor: f.create })

  const on = await cam.setBlur(true)
  assert.equal(on.ok, true)
  assert.equal(on.track, f.made[0].track)
  assert.equal(cam.blurred, true)

  const off = await cam.setBlur(false)
  assert.equal(off.track, raw)
  assert.equal(cam.blurred, false)
  assert.equal(f.made[0].stopped, true, 'the processor is stopped when blur goes off')
  assert.equal(raw.stopped, false, 'turning blur off must not turn the camera off')
})

test('the processor is given the camera track', async () => {
  const raw = track('raw')
  const f = factory()
  await openCamera(raw, { createProcessor: f.create }).setBlur(true)
  assert.equal(f.made[0].raw, raw)
})

test('a processor that cannot start leaves the plain camera running', async () => {
  const raw = track('raw')
  const cam = openCamera(raw, { createProcessor: factory({ failWith: new Error('no webgl') }).create })
  const r = await cam.setBlur(true)
  assert.equal(r.ok, false)
  assert.equal(r.error.message, 'no webgl')
  assert.equal(r.track, raw)
  assert.equal(cam.blurred, false)
  assert.equal(raw.stopped, false)
})

test('asking for what is already true does nothing', async () => {
  const f = factory()
  const cam = openCamera(track('raw'), { createProcessor: f.create })
  await cam.setBlur(false)
  await cam.setBlur(true)
  await cam.setBlur(true)
  assert.equal(f.made.length, 1)
})

test('switching on and off quickly never leaves a processor running', async () => {
  const f = factory({ delay: 10 })
  const cam = openCamera(track('raw'), { createProcessor: f.create })
  const results = await Promise.all([cam.setBlur(true), cam.setBlur(false), cam.setBlur(true), cam.setBlur(false)])
  assert.equal(cam.blurred, false)
  assert.equal(f.made.every(p => p.stopped), true)
  assert.equal(results.every(r => r.ok), true)
})

test('stop closes the processor and the camera, and twice is fine', async () => {
  const raw = track('raw')
  const f = factory()
  const cam = openCamera(raw, { createProcessor: f.create })
  await cam.setBlur(true)
  cam.stop()
  cam.stop()
  assert.equal(f.made[0].stopped, true)
  assert.equal(raw.stopped, true)
})

test('closing the camera while the blur is still starting does not leak the processor', async () => {
  const raw = track('raw')
  const f = factory({ delay: 20 })
  const cam = openCamera(raw, { createProcessor: f.create })
  const pending = cam.setBlur(true)
  await new Promise(r => setTimeout(r, 5)) // the processor is now mid-start
  cam.stop()
  await pending
  assert.equal(f.made.every(p => p.stopped), true)
  assert.equal(cam.blurred, false)
})

test('blur cannot be turned on after the camera was stopped', async () => {
  const f = factory()
  const cam = openCamera(track('raw'), { createProcessor: f.create })
  cam.stop()
  await cam.setBlur(true)
  assert.equal(f.made.length, 0)
})

// ---------- the remembered choice ----------

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }

test('the choice is off until it is turned on, then remembered', () => {
  const s = memory()
  assert.equal(loadBlurPref(s), false)
  saveBlurPref(true, s)
  assert.equal(loadBlurPref(s), true)
  saveBlurPref(false, s)
  assert.equal(loadBlurPref(s), false)
})

test('storage that throws (private mode) just means "off"', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(loadBlurPref(broken), false)
  assert.doesNotThrow(() => saveBlurPref(true, broken))
  assert.equal(loadBlurPref(null), false)
})
