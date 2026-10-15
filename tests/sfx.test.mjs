// Checks the sound effects are what the spec says they are, by reading the
// committed WAV files back and measuring them — there is no ear in CI, so this
// tests the properties that make a sound good or bad: no clicks, no seams in a
// loop, the right pitches, the right loudness.
//
//   node --test tests/sfx.test.mjs
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OUTPUT_DIRS, SAMPLE_RATE, SOUNDS, wavFor } from '../scripts/generate-sfx.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const names = Object.keys(SOUNDS)

function readWav(path) {
  const b = readFileSync(path)
  assert.equal(b.toString('ascii', 0, 4), 'RIFF')
  assert.equal(b.toString('ascii', 8, 12), 'WAVE')
  assert.equal(b.readUInt16LE(20), 1, 'PCM')
  assert.equal(b.readUInt16LE(22), 1, 'mono')
  assert.equal(b.readUInt32LE(24), SAMPLE_RATE)
  assert.equal(b.readUInt16LE(34), 16, '16-bit')
  assert.equal(b.toString('ascii', 36, 40), 'data')
  const n = b.readUInt32LE(40) / 2
  assert.equal(b.length, 44 + n * 2, 'header length matches the data')
  const s = new Float64Array(n)
  for (let i = 0; i < n; i++) s[i] = b.readInt16LE(44 + i * 2) / 32768
  return s
}

/** Signal power at one frequency (Goertzel): how much of `f` is in the sound. */
function power(samples, f) {
  const w = (2 * Math.PI * f) / SAMPLE_RATE
  const c = 2 * Math.cos(w)
  let s1 = 0, s2 = 0
  for (const x of samples) { const s0 = x + c * s1 - s2; s2 = s1; s1 = s0 }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / samples.length
}

const rms = (a) => Math.sqrt(a.reduce((t, x) => t + x * x, 0) / a.length)

test('both committed copies are exactly what the generator produces', () => {
  for (const dir of OUTPUT_DIRS) {
    for (const name of names) {
      const onDisk = readFileSync(join(root, dir, `${name}.wav`))
      assert.ok(onDisk.equals(wavFor(name)), `${dir}/${name}.wav is stale: run node scripts/generate-sfx.mjs`)
    }
  }
})

for (const name of names) {
  const spec = SOUNDS[name]
  const samples = readWav(join(root, OUTPUT_DIRS[0], `${name}.wav`))

  test(`${name}: right length`, () => {
    assert.equal(samples.length, Math.round(spec.length * SAMPLE_RATE))
  })

  test(`${name}: as loud as its gain says, and never clipping`, () => {
    const peak = Math.max(...samples.map(Math.abs))
    assert.ok(peak <= spec.gain + 0.001, `peak ${peak} above gain ${spec.gain}`)
    assert.ok(peak >= spec.gain - 0.01, `peak ${peak} well below gain ${spec.gain}`)
    assert.ok(peak < 0.6, 'nothing here should be able to startle someone')
  })

  test(`${name}: starts and ends at silence, so it cannot click`, () => {
    // A click is a sound that starts or stops away from zero: the speaker jumps.
    assert.ok(Math.abs(samples[0]) < 0.003, `starts at ${samples[0]}, not silence`)
    assert.ok(Math.abs(samples.at(-1)) < 0.003, `ends at ${samples.at(-1)}, not silence`)
    // And nothing inside the sound may jump either: the largest step between
    // neighbouring samples stays within what a smooth waveform of this size and
    // pitch can do.
    let worst = 0
    for (let i = 1; i < samples.length; i++) worst = Math.max(worst, Math.abs(samples[i] - samples[i - 1]))
    assert.ok(worst < 1.2 * spec.gain, `a ${worst.toFixed(3)} jump between samples sounds like a click`)
  })

  if (spec.loop) {
    test(`${name}: loops without a seam`, () => {
      // A loop that ends mid-note would jump from that note straight back to the
      // start. Ending in silence means the join is inaudible.
      const tail = samples.slice(-Math.round(SAMPLE_RATE * 0.25))
      assert.ok(rms(tail) < 0.0005, `last 250ms is not silent (rms ${rms(tail)})`)
    })
  } else {
    test(`${name}: is short enough to be an effect, not a distraction`, () => {
      assert.ok(spec.length <= 0.7)
    })
  }
}

test('the right notes are in the right sounds', () => {
  const heard = (name, f) => power(readWav(join(root, OUTPUT_DIRS[0], `${name}.wav`)), f)
  const present = (name, f, offBy = 1.17) => {
    // A note counts as present if it is clearly louder than a pitch a little off it.
    assert.ok(heard(name, f) > 6 * heard(name, f * offBy), `${name} should contain ${f} Hz`)
  }
  present('dm_ping', 988); present('dm_ping', 1319)
  present('voice_join', 523); present('voice_join', 659); present('voice_join', 784)
  present('voice_leave', 523); present('voice_leave', 659); present('voice_leave', 784)
  present('ring', 784); present('ring', 988)
  present('ringback', 440); present('ringback', 554)
  present('call_connected', 659); present('call_connected', 988)
  present('call_ended', 784); present('call_ended', 523)
})

test('join rises and leave falls, so they cannot be mistaken for each other', () => {
  // Where in time does the energy at the low and high notes sit?
  const centroid = (name, f) => {
    const s = readWav(join(root, OUTPUT_DIRS[0], `${name}.wav`))
    const win = Math.round(SAMPLE_RATE * 0.05)
    let sum = 0, weighted = 0
    for (let i = 0; i + win <= s.length; i += win) {
      const p = power(s.slice(i, i + win), f)
      sum += p; weighted += p * (i / SAMPLE_RATE)
    }
    return weighted / sum
  }
  for (const [rise, fall] of [['voice_join', 'voice_leave'], ['call_connected', 'call_ended']]) {
    const [lo, hi] = rise === 'voice_join' ? [523, 784] : [659, 988]
    const [lo2, hi2] = fall === 'voice_leave' ? [523, 784] : [523, 784]
    assert.ok(centroid(rise, lo) < centroid(rise, hi), `${rise}: low note should come first`)
    assert.ok(centroid(fall, hi2) < centroid(fall, lo2), `${fall}: high note should come first`)
  }
})

test('no two sounds are the same', () => {
  const hashes = names.map(n => createHash('sha1').update(wavFor(n)).digest('hex'))
  assert.equal(new Set(hashes).size, names.length)
})

test('the ringing sounds are told apart by loudness, not just pitch', () => {
  // An incoming call must out-shout a join chime; the caller's ringback must be
  // gentler than the incoming ring.
  assert.ok(SOUNDS.ring.gain > SOUNDS.ringback.gain)
  assert.ok(SOUNDS.ring.gain > SOUNDS.voice_join.gain)
  assert.ok(SOUNDS.peer_join.gain < SOUNDS.voice_join.gain)
})
