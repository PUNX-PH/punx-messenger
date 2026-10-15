/**
 * Generates the app's sound effects as small WAV files, so there is nothing to
 * license and the web and Android apps play byte-identical audio.
 *
 *   node scripts/generate-sfx.mjs          # writes public/sfx and android_app/assets/sfx
 *
 * The WAVs are committed; this script is the source of truth for them. To change
 * a sound, edit its entry in SOUNDS below and re-run. tests/sfx.test.mjs checks
 * the committed files still match what this produces.
 *
 * Every sound is a few decaying bell-like notes (a sine plus two quiet
 * overtones) with a short fade-in and fade-out, so none of them clicks. The two
 * `loop: true` sounds end in silence, so they repeat without a seam.
 *
 * 16 kHz, mono, 16-bit: every tone is under 4 kHz even with its overtones, so this
 * loses nothing and keeps all nine files at about 280 KB together.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SAMPLE_RATE = 16000

/**
 * t = start (s), d = length (s), f = Hz, or [from, to] for a glide, g = gain 0..1.
 * `length` is the file's total duration; a loop's silence is part of the sound.
 * `gain` scales the whole mix, and is what keeps an incoming call audible while a
 * channel join stays polite.
 */
export const SOUNDS = {
  // A double burst of a major third, then a pause: unmistakably "someone is
  // calling", and different from every other sound here.
  ring: {
    loop: true, length: 2.6, gain: 0.5,
    notes: [
      { t: 0.00, d: 0.45, f: 784, g: 0.6 }, { t: 0.00, d: 0.45, f: 988, g: 0.5 },
      { t: 0.30, d: 0.45, f: 784, g: 0.6 }, { t: 0.30, d: 0.45, f: 988, g: 0.5 },
      { t: 0.60, d: 0.55, f: 1175, g: 0.5 }, { t: 0.60, d: 0.55, f: 784, g: 0.4 },
    ],
  },
  // What the caller hears while it rings: softer and slower than ring, so it
  // reads as "ringing at the other end" rather than as an alert of their own.
  ringback: {
    loop: true, length: 3.2, gain: 0.3,
    notes: [
      { t: 0.00, d: 0.9, f: 440, g: 0.6, hold: true }, { t: 0.00, d: 0.9, f: 554, g: 0.5, hold: true },
    ],
  },
  call_connected: {
    length: 0.55, gain: 0.4,
    notes: [{ t: 0.00, d: 0.22, f: 659, g: 0.7 }, { t: 0.11, d: 0.4, f: 988, g: 0.7 }],
  },
  call_ended: {
    length: 0.55, gain: 0.4,
    notes: [{ t: 0.00, d: 0.22, f: 784, g: 0.7 }, { t: 0.11, d: 0.4, f: 523, g: 0.7 }],
  },
  dm_ping: {
    length: 0.4, gain: 0.45,
    notes: [{ t: 0.00, d: 0.14, f: 988, g: 0.7 }, { t: 0.09, d: 0.28, f: 1319, g: 0.7 }],
  },
  voice_join: {
    length: 0.6, gain: 0.35,
    notes: [
      { t: 0.00, d: 0.2, f: 523, g: 0.7 }, { t: 0.08, d: 0.2, f: 659, g: 0.7 },
      { t: 0.16, d: 0.4, f: 784, g: 0.7 },
    ],
  },
  voice_leave: {
    length: 0.6, gain: 0.35,
    notes: [
      { t: 0.00, d: 0.2, f: 784, g: 0.7 }, { t: 0.08, d: 0.2, f: 659, g: 0.7 },
      { t: 0.16, d: 0.4, f: 523, g: 0.7 },
    ],
  },
  // Someone else arriving / leaving: a single short tick, quieter than your own
  // join so a busy channel does not become a wall of chimes.
  peer_join: {
    length: 0.25, gain: 0.25,
    notes: [{ t: 0.00, d: 0.16, f: [600, 900], g: 0.8 }],
  },
  peer_leave: {
    length: 0.25, gain: 0.25,
    notes: [{ t: 0.00, d: 0.16, f: [900, 600], g: 0.8 }],
  },
}

const ATTACK = 0.008 // s, fade-in: no click at the start of a note
const RELEASE = 0.03 // s, fade-out: no click at the end of one

/** Renders one sound to float samples in -1..1. */
export function render(spec) {
  const n = Math.round(spec.length * SAMPLE_RATE)
  const out = new Float64Array(n)
  for (const note of spec.notes) {
    const start = Math.round(note.t * SAMPLE_RATE)
    const len = Math.round(note.d * SAMPLE_RATE)
    const [f0, f1] = Array.isArray(note.f) ? note.f : [note.f, note.f]
    let phase = 0
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / SAMPLE_RATE
      const f = f0 + (f1 - f0) * (i / len)
      phase += (2 * Math.PI * f) / SAMPLE_RATE
      // Bell-like: strong fundamental, quiet 2nd and 3rd harmonics.
      const tone = Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase)
      // `hold` sustains (a ringback tone); otherwise the note rings out and decays.
      const decay = note.hold ? 1 : Math.exp((-4 * i) / len)
      const attack = Math.min(1, t / ATTACK)
      const release = Math.min(1, (len - i) / (RELEASE * SAMPLE_RATE))
      out[start + i] += tone * decay * attack * release * note.g
    }
  }
  // Normalise to this sound's own peak, then apply its gain: every sound is as
  // loud as its `gain` says, however many notes it stacks.
  let peak = 0
  for (const s of out) peak = Math.max(peak, Math.abs(s))
  const scale = peak > 0 ? spec.gain / peak : 0
  for (let i = 0; i < n; i++) out[i] *= scale
  return out
}

/** 16-bit PCM mono WAV. */
export function toWav(samples) {
  const dataBytes = samples.length * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

export const wavFor = (name) => toWav(render(SOUNDS[name]))

/** Where the committed copies live: the web app serves public/, Flutter bundles assets/. */
export const OUTPUT_DIRS = ['public/sfx', 'android_app/assets/sfx']

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  let total = 0
  for (const dir of OUTPUT_DIRS) {
    mkdirSync(join(root, dir), { recursive: true })
    for (const name of Object.keys(SOUNDS)) {
      const wav = wavFor(name)
      writeFileSync(join(root, dir, `${name}.wav`), wav)
      if (dir === OUTPUT_DIRS[0]) {
        total += wav.length
        console.log(`${name}.wav  ${(wav.length / 1024).toFixed(1)} KB  ${SOUNDS[name].length}s${SOUNDS[name].loop ? ' (loops)' : ''}`)
      }
    }
  }
  console.log(`\n${Object.keys(SOUNDS).length} sounds, ${(total / 1024).toFixed(0)} KB each copy, written to ${OUTPUT_DIRS.join(' and ')}`)
}
