// The sound player's behaviour and the call-sound rules, run under Node with a
// fake `Audio` — what is checked is when sounds start and stop, not how they
// sound (tests/sfx.test.mjs measures the audio itself).
//
//   node --test tests/sfx-player.test.mjs
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Browser stand-ins, installed BEFORE the module is imported ──
const created = []
class FakeAudio {
  constructor(url) {
    this.url = url; this.plays = 0; this.paused = true; this.loop = false; this.currentTime = 0
    this.blocked = false // a browser refusing autoplay
    created.push(this)
  }
  play() {
    this.plays += 1
    if (this.blocked) return Promise.reject(new Error('NotAllowedError'))
    this.paused = false
    return Promise.resolve()
  }
  pause() { this.paused = true }
}
const storage = new Map()
const listeners = {}
globalThis.Audio = FakeAudio
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => { storage.set(k, String(v)) },
}
globalThis.addEventListener = (type, fn) => { (listeners[type] ??= []).push(fn) }
const unlockGesture = () => (listeners.pointerdown ?? []).forEach(fn => fn())

let clock = 1_000_000
const realNow = Date.now
Date.now = () => clock

const sfx = await import('../src/lib/sfx.js')
const { callSoundActions, rosterSounds } = await import('../src/lib/sfxRules.js')

const audioFor = (name) => created.find(a => a.url === `/sfx/${name}.wav`)

beforeEach(() => {
  created.length = 0
  storage.clear()
  clock += 60_000
  sfx._reset()
})

test('plays the file for the sound, from the start', () => {
  sfx.play('dm_ping')
  const a = audioFor('dm_ping')
  assert.ok(a, 'created an Audio for /sfx/dm_ping.wav')
  assert.equal(a.plays, 1)
  assert.equal(a.loop, false)
})

test('only the two ringing sounds loop', () => {
  for (const n of sfx.SOUNDS) sfx.play(n)
  for (const a of created) {
    const name = a.url.replace('/sfx/', '').replace('.wav', '')
    assert.equal(a.loop, name === 'ring' || name === 'ringback', name)
  }
})

test('an unknown sound is ignored, not an error', () => {
  assert.doesNotThrow(() => sfx.play('nonsense'))
  assert.equal(created.length, 0)
})

test('without Audio at all (an old or locked-down browser) nothing throws', () => {
  const saved = globalThis.Audio
  globalThis.Audio = undefined
  try { assert.doesNotThrow(() => sfx.play('ring')) } finally { globalThis.Audio = saved }
})

test('a burst is throttled, and resumes after the gap', () => {
  sfx.play('peer_join'); sfx.play('peer_join'); sfx.play('peer_join')
  assert.equal(audioFor('peer_join').plays, 1, '30 people joining must not be 30 chimes')
  clock += 400
  sfx.play('peer_join')
  assert.equal(audioFor('peer_join').plays, 2)
})

test('throttling is per sound: a join and a leave in the same moment both play', () => {
  sfx.play('peer_join'); sfx.play('peer_leave')
  assert.equal(audioFor('peer_join').plays, 1)
  assert.equal(audioFor('peer_leave').plays, 1)
})

test('sounds without a gap are never throttled (your own join/leave chimes)', () => {
  sfx.play('voice_join'); sfx.play('voice_join')
  assert.equal(audioFor('voice_join').plays, 2)
})

test('turning sound off silences everything and stops what is ringing', () => {
  sfx.play('ring')
  const ring = audioFor('ring')
  assert.equal(ring.paused, false)
  sfx.setEnabled(false)
  assert.equal(ring.paused, true, 'the ring stops')
  sfx.play('dm_ping'); sfx.play('voice_join')
  assert.equal(audioFor('dm_ping'), undefined, 'nothing new starts')
  assert.equal(audioFor('voice_join'), undefined)
  assert.equal(storage.get('sfx'), 'off', 'and the choice is remembered')
})

test('the stored preference is read back, and a fresh page defaults to on', () => {
  assert.equal(sfx.isEnabled(), true)
  storage.set('sfx', 'off')
  sfx._reset()
  assert.equal(sfx.isEnabled(), false)
  storage.set('sfx', 'on')
  sfx._reset()
  assert.equal(sfx.isEnabled(), true)
})

test('subscribers hear about a change', () => {
  const seen = []
  const off = sfx.subscribe(v => seen.push(v))
  sfx.setEnabled(false); sfx.setEnabled(true)
  off(); sfx.setEnabled(false)
  assert.deepEqual(seen, [false, true])
})

test('switching sound back on mid-ring does not start that ring late', () => {
  // The ring has sounded before, so its audio element exists: that is the case
  // where a remembered-but-refused ring could be revived by the next click.
  sfx.play('ring')
  sfx.stop('ring')
  const ring = audioFor('ring')
  const before = ring.plays

  sfx.setEnabled(false)
  sfx.play('ring') // a call arrives while sound is off: refused AND not remembered
  sfx.setEnabled(true)
  unlockGesture() // the person clicks something
  assert.equal(ring.plays, before, 'the ring must not start now')
  assert.equal(ring.paused, true)
})

test('stop() really stops, and a stopped loop is not revived', () => {
  sfx.play('ringback')
  const a = audioFor('ringback')
  sfx.stop('ringback')
  assert.equal(a.paused, true)
  const before = a.plays
  unlockGesture()
  assert.equal(a.plays, before, 'a later click must not restart a stopped ringback')
})

test('a refused ring is retried on the next interaction; a refused ping is not', async () => {
  // Autoplay blocked: nothing has started, and play() must not throw.
  globalThis.Audio = class extends FakeAudio { constructor(u) { super(u); this.blocked = true } }
  sfx._reset(); created.length = 0
  sfx.play('ring'); sfx.play('dm_ping')
  await new Promise(r => setImmediate(r)) // let the rejections settle: none may escape
  assert.equal(audioFor('ring').plays, 1)
  assert.equal(audioFor('dm_ping').plays, 1)

  // The person clicks: autoplay is now allowed.
  audioFor('ring').blocked = false
  audioFor('dm_ping').blocked = false
  unlockGesture()
  assert.equal(audioFor('ring').plays, 2, 'the ringing call is picked up')
  assert.equal(audioFor('dm_ping').plays, 1, 'a ping that arrived earlier stays dropped')
  globalThis.Audio = FakeAudio
})

test('a loop that is already sounding is not restarted by a click', () => {
  sfx.play('ring')
  const a = audioFor('ring')
  unlockGesture()
  assert.equal(a.plays, 1)
})

// ── What each call status change should do ──
test('call sounds: the whole life of a call', () => {
  const step = (prev, next) => callSoundActions(prev, next)
  assert.deepEqual(step('idle', 'incoming').play, 'ring')
  assert.deepEqual(step('idle', 'outgoing').play, 'ringback')
  assert.deepEqual(step('incoming', 'connected').play, 'call_connected')
  assert.deepEqual(step('outgoing', 'connected').play, 'call_connected')
  assert.deepEqual(step('connected', 'idle').play, 'call_ended')
})

test('call sounds: an unanswered or declined outgoing call ends audibly', () => {
  assert.equal(callSoundActions('outgoing', 'idle').play, 'call_ended')
})

test('call sounds: an incoming call that stops ringing is silent', () => {
  // I declined it, or the caller gave up — it is already quiet.
  assert.equal(callSoundActions('incoming', 'idle').play, null)
})

test('call sounds: every change stops any ring, and no change does nothing', () => {
  for (const [p, n] of [['idle', 'incoming'], ['incoming', 'connected'], ['outgoing', 'idle'], ['connected', 'idle'], ['incoming', 'idle']]) {
    assert.deepEqual(callSoundActions(p, n).stop, ['ring', 'ringback'], `${p} -> ${n}`)
  }
  assert.deepEqual(callSoundActions('connected', 'connected'), { stop: [], play: null })
})

// ── Voice-channel comings and goings ──
const roster = (o) => rosterSounds({ primed: true, deafened: false, myUid: 'me', added: [], removed: [], ...o })

test('roster: someone else joining or leaving makes a tick', () => {
  assert.deepEqual(roster({ added: ['ana'] }), ['peer_join'])
  assert.deepEqual(roster({ removed: ['ana'] }), ['peer_leave'])
  assert.deepEqual(roster({ added: ['ana'], removed: ['ben'] }), ['peer_join', 'peer_leave'])
})

test('roster: a burst of joiners is ONE sound, not one each', () => {
  assert.deepEqual(roster({ added: ['a', 'b', 'c', 'd', 'e'] }), ['peer_join'])
})

test('roster: the first snapshot (everyone already here) is silent', () => {
  assert.deepEqual(roster({ primed: false, added: ['ana', 'ben', 'cal'] }), [])
})

test('roster: my own appearance is not a "peer" joining', () => {
  assert.deepEqual(roster({ added: ['me'] }), [])
  assert.deepEqual(roster({ removed: ['me'] }), [])
  assert.deepEqual(roster({ added: ['me', 'ana'] }), ['peer_join'], 'but someone with me still counts')
})

test('roster: deafened means you hear nobody come or go', () => {
  assert.deepEqual(roster({ deafened: true, added: ['ana'], removed: ['ben'] }), [])
})

test('roster: nothing changed, nothing to hear', () => {
  assert.deepEqual(roster({}), [])
})

test.after(() => { Date.now = realNow })
