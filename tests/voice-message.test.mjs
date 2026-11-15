// Voice messages: the limits and the checks on what is played, the recorder (with a stand-in
// microphone), forwarding and saving one, and that the button, the player and the send are wired.
//
//   node --test tests/voice-message.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  MAX_VOICE_CHARS, MAX_VOICE_MS, MIN_VOICE_MS, VOICE_BITS_PER_SECOND, audioOf, checkRecording, formatDuration,
  isPlayableAudioURL, pickMimeType, voiceErrorText,
} from '../src/lib/voiceMessage.js'
import { VoiceError, blobToDataURL, canRecord, finishRecording, startRecording } from '../src/lib/voiceRecorder.js'
import { canForward, forwardPayload, forwardPreview } from '../src/lib/forward.js'

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const OK_URL = 'data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAHTEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBJUqWZTrIHfTbuMU6uEFlSua1OsggEw'

// ---------- the limits ----------

test('the limits are what a message document can hold', () => {
  assert.equal(MAX_VOICE_MS, 60_000)
  assert.equal(MIN_VOICE_MS, 700)
  assert.equal(VOICE_BITS_PER_SECOND, 16_000)
  // a full minute at that rate, written as text (a third more), must fit under the character limit with room to spare
  const bytes = (VOICE_BITS_PER_SECOND / 8) * (MAX_VOICE_MS / 1000)
  assert.ok(Math.ceil(bytes / 3) * 4 < MAX_VOICE_CHARS * 0.5, 'a minute is under half the limit')
  assert.ok(MAX_VOICE_CHARS < 1024 * 1024, 'and the limit leaves room in a 1 MiB document')
})

// ---------- which format to ask for ----------

test('the first format the browser accepts wins, and none means let it choose', () => {
  assert.equal(pickMimeType(() => true), 'audio/mp4;codecs=mp4a.40.2', 'AAC in MP4, the one every phone plays, comes first')
  assert.equal(pickMimeType((t) => !t.startsWith('audio/mp4')), 'audio/webm;codecs=opus', 'Firefox')
  assert.equal(pickMimeType((t) => t === 'audio/ogg;codecs=opus'), 'audio/ogg;codecs=opus')
  assert.equal(pickMimeType((t) => t === 'audio/mp4;codecs=mp4a.40.2'), 'audio/mp4;codecs=mp4a.40.2', 'Safari')
  assert.equal(pickMimeType((t) => t === 'audio/mp4'), 'audio/mp4', 'a Safari that does not know the codec spelling')
  assert.equal(pickMimeType((t) => t === 'audio/mp4' || t.startsWith('audio/webm')), 'audio/webm;codecs=opus', 'plain MP4 (Opus in Chrome) is only the last resort')
  assert.equal(pickMimeType(() => false), '')
  assert.equal(pickMimeType(undefined), '')
  assert.equal(pickMimeType(() => { throw new Error('x') }), '', 'a browser that throws is just unsupported')
  assert.equal(pickMimeType((t) => { if (t.startsWith('audio/mp4;')) throw new Error('x'); return t === 'audio/mp4' }), 'audio/mp4')
})

// ---------- what may be played ----------

test('only a plain audio data address is playable', () => {
  assert.equal(isPlayableAudioURL(OK_URL), true)
  assert.equal(isPlayableAudioURL('data:audio/mp4;base64,AAAA'), true)
  assert.equal(isPlayableAudioURL('data:audio/ogg;codecs=opus;base64,AAAA'), true)
  assert.equal(isPlayableAudioURL('data:audio/mp4;codecs=mp4a.40.2;base64,AAAA'), true)
  assert.equal(isPlayableAudioURL('data:audio/webm;base64,AA+/AA=='), true)
  for (const t of ['webm', 'ogg', 'mp4', 'mpeg', 'aac', 'wav', 'x-m4a']) assert.equal(isPlayableAudioURL('data:audio/' + t + ';base64,AAAA'), true, t)
})

test('anything that would be fetched, or is not audio, or is not base64, is refused', () => {
  for (const u of [
    'https://tracker.example/x.webm', 'http://x.test/a.mp3', '//x.test/a', 'blob:https://x/1', 'javascript:alert(1)',
    'data:text/html;base64,AAAA', 'data:image/png;base64,AAAA', 'data:video/webm;base64,AAAA', 'data:audio/webm,AAAA', 'data:audio/webm;base64,',
    'data:audio/webm;base64,AA AA', 'data:audio/webm;base64,AA\nAA', 'data:audio/evil;base64,AAAA', 'data:audio/webm;codecs=<x>;base64,AAAA',
    'DATA:audio/webm;base64,AAAA', ' data:audio/webm;base64,AAAA', 'data:audio/webm;base64,AAAA ', '', null, undefined, 5, {}, ['data:audio/webm;base64,AAAA'],
  ]) assert.equal(isPlayableAudioURL(u), false, String(u))
})

test('a data address over the size limit is refused', () => {
  const head = 'data:audio/webm;base64,'
  assert.equal(isPlayableAudioURL(head + 'A'.repeat(MAX_VOICE_CHARS - head.length)), true)
  assert.equal(isPlayableAudioURL(head + 'A'.repeat(MAX_VOICE_CHARS - head.length + 1)), false)
})

test('a voice message on a message is read back cleaned, and nothing else is played', () => {
  assert.deepEqual(audioOf({ audioURL: OK_URL, audioMeta: { durationMs: 7400 } }), { url: OK_URL, durationMs: 7400 })
  assert.deepEqual(audioOf({ audioURL: OK_URL }), { url: OK_URL, durationMs: 0 }, 'no length stored: unknown, not an error')
  assert.equal(audioOf({ audioURL: OK_URL, audioMeta: { durationMs: 999_999 } }).durationMs, MAX_VOICE_MS, 'a length is never above the limit')
  for (const d of [-5, 0, NaN, Infinity, 'abc', null, {}, []]) assert.equal(audioOf({ audioURL: OK_URL, audioMeta: { durationMs: d } }).durationMs, 0, String(d))
  assert.equal(audioOf({ audioURL: OK_URL, audioMeta: 'x' }).durationMs, 0)
  for (const m of [null, undefined, {}, { audioURL: 'https://x.test/a.webm' }, { audioURL: 7 }, { imageURL: OK_URL }]) assert.equal(audioOf(m), null, JSON.stringify(m))
})

// ---------- how a length reads ----------

test('lengths read as minutes and seconds, rounded to the nearest second', () => {
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(7400), '0:07')
  assert.equal(formatDuration(7600), '0:08')
  assert.equal(formatDuration(65_000), '1:05')
  assert.equal(formatDuration(60_000), '1:00')
  assert.equal(formatDuration(599_000), '9:59')
  for (const x of [-1, NaN, Infinity, undefined, null, 'x', {}]) assert.equal(formatDuration(x), x === Infinity ? '0:00' : '0:00', String(x))
})

// ---------- may it be sent ----------

test('a recording may be sent when it is long enough, not too long, and playable', () => {
  assert.equal(checkRecording({ durationMs: 3000, dataURL: OK_URL }), 'ok')
  assert.equal(checkRecording({ durationMs: MIN_VOICE_MS, dataURL: OK_URL }), 'ok', 'exactly the shortest')
  assert.equal(checkRecording({ durationMs: MIN_VOICE_MS - 1, dataURL: OK_URL }), 'short')
  assert.equal(checkRecording({ durationMs: MAX_VOICE_MS, dataURL: OK_URL }), 'ok')
  assert.equal(checkRecording({ durationMs: MAX_VOICE_MS + 1500, dataURL: OK_URL }), 'ok', 'a little timing slack')
  assert.equal(checkRecording({ durationMs: MAX_VOICE_MS + 1501, dataURL: OK_URL }), 'long')
  assert.equal(checkRecording({ durationMs: 3000, dataURL: 'data:audio/webm;base64,' + 'A'.repeat(MAX_VOICE_CHARS) }), 'big')
  assert.equal(checkRecording({ durationMs: 3000, dataURL: 'data:text/html;base64,AAAA' }), 'big')
  for (const d of [undefined, null, NaN, 'x', -1, 0]) assert.equal(checkRecording({ durationMs: d, dataURL: OK_URL }), 'short', String(d))
})

test('every reason has words, and an unknown one still has some', () => {
  for (const c of ['denied', 'no-mic', 'unsupported', 'short', 'long', 'big', 'failed', 'whatever', undefined]) {
    const t = voiceErrorText(c)
    assert.ok(typeof t === 'string' && t.length > 10 && !/error|exception/i.test(t), String(c))
  }
  assert.notEqual(voiceErrorText('denied'), voiceErrorText('no-mic'))
  assert.match(voiceErrorText('denied'), /microphone/i)
})

// ---------- the recorder, with a stand-in microphone ----------

function fakeEnv({ supported = ['audio/webm;codecs=opus'], getUserMedia, recorderThrows = false, startThrows = false, tracksLog = [], emit = [{ data: { size: 5, tag: 'chunk' } }], hangs = false } = {}) {
  const made = []
  class MediaRecorder {
    static isTypeSupported(t) { return supported.includes(t) }
    constructor(stream, options) {
      if (recorderThrows) throw new Error('nope')
      this.stream = stream; this.options = options; this.state = 'inactive'; this.mimeType = options?.mimeType || ''
      made.push(this)
    }
    start(slice) { if (startThrows) throw new Error('nope'); this.state = 'recording'; this.slice = slice }
    stop() { this.stops = (this.stops || 0) + 1; this.state = 'inactive'; for (const e of emit) this.ondataavailable?.(e); if (!hangs) queueMicrotask(() => this.onstop?.()) }
    kill() { this.state = 'inactive' }
  }
  class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type } }
  const stream = { getTracks: () => [{ stop: () => tracksLog.push('stopped') }, { stop: () => tracksLog.push('stopped') }] }
  return {
    env: {
      navigator: { mediaDevices: { getUserMedia: getUserMedia || (async (c) => { made.constraints = c; return stream }) } },
      MediaRecorder, Blob,
      FileReader: class { readAsDataURL(b) { setTimeout(() => { this.result = OK_URL; this.onload?.() }, 0) } },
    },
    made, tracksLog,
  }
}

test('where the browser cannot record, it says so before asking for anything', async () => {
  assert.equal(canRecord({}), false)
  assert.equal(canRecord({ navigator: {} }), false)
  assert.equal(canRecord({ navigator: { mediaDevices: {} }, MediaRecorder: class {} }), false)
  assert.equal(canRecord({ navigator: { mediaDevices: { getUserMedia() {} } } }), false)
  assert.equal(canRecord(fakeEnv().env), true)
  await assert.rejects(() => startRecording({}), (e) => e instanceof VoiceError && e.code === 'unsupported')
})

test('a refused microphone, a missing one, and any other failure are told apart', async () => {
  const fail = (name) => fakeEnv({ getUserMedia: async () => { const e = new Error('x'); e.name = name; throw e } }).env
  for (const n of ['NotAllowedError', 'SecurityError', 'PermissionDeniedError']) await assert.rejects(() => startRecording(fail(n)), (e) => e.code === 'denied', n)
  for (const n of ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']) await assert.rejects(() => startRecording(fail(n)), (e) => e.code === 'no-mic', n)
  await assert.rejects(() => startRecording(fail('AbortError')), (e) => e.code === 'failed')
  await assert.rejects(() => startRecording(fakeEnv({ getUserMedia: async () => { throw null } }).env), (e) => e.code === 'failed')
})

test('it asks for the microphone with echo and noise cleaned up, and records at the speech bit rate in the best format', async () => {
  const f = fakeEnv()
  const c = await startRecording(f.env)
  assert.deepEqual(f.made.constraints, { audio: { echoCancellation: true, noiseSuppression: true } })
  assert.deepEqual(f.made[0].options, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 })
  assert.equal(f.made[0].state, 'recording')
  await c.stop()
})

test('with no format the browser accepts, it lets the browser choose', async () => {
  const f = fakeEnv({ supported: [] })
  const c = await startRecording(f.env)
  assert.deepEqual(f.made[0].options, { audioBitsPerSecond: 16000 })
  await c.stop()
})

test('stopping gives the recording, its length and its format, and turns the microphone off', async () => {
  const f = fakeEnv()
  const c = await startRecording(f.env)
  await new Promise((r) => setTimeout(r, 30))
  const out = await c.stop()
  assert.equal(out.mime, 'audio/webm;codecs=opus')
  assert.equal(out.blob.type, 'audio/webm;codecs=opus')
  assert.equal(out.blob.parts.length, 1)
  assert.ok(out.durationMs >= 25 && out.durationMs < 500, String(out.durationMs))
  assert.deepEqual(f.tracksLog, ['stopped', 'stopped'], 'every track stopped')
})

test('asking to stop twice is the same stop', async () => {
  const c = await startRecording(fakeEnv().env)
  const a = c.stop(), b = c.stop()
  assert.equal(a, b)
  await a
})

test('cancelling throws the recording away and turns the microphone off', async () => {
  const f = fakeEnv()
  const c = await startRecording(f.env)
  c.cancel()
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(f.tracksLog.length >= 2 && f.tracksLog.every((x) => x === 'stopped'))
  assert.equal(f.made[0].state, 'inactive')
  c.cancel() // a second one is harmless
})

test('stopping after a cancel says it was cancelled', async () => {
  const c = await startRecording(fakeEnv().env)
  c.cancel()
  await assert.rejects(() => c.stop(), (e) => e.code === 'cancelled')
})

test('if the recorder cannot be made or started, the microphone is turned off and it is a failure', async () => {
  for (const opt of [{ recorderThrows: true }, { startThrows: true }]) {
    const f = fakeEnv(opt)
    await assert.rejects(() => startRecording(f.env), (e) => e.code === 'failed')
    assert.deepEqual(f.tracksLog, ['stopped', 'stopped'], JSON.stringify(opt))
  }
})

test('the ticks report the time so far, and at the limit it stops itself and says so', async () => {
  const f = fakeEnv()
  const ticks = []
  let limit = 0
  const c = await startRecording(f.env, { maxMs: 450, onTick: (ms) => ticks.push(ms), onLimit: () => { limit++ } })
  await new Promise((r) => setTimeout(r, 900))
  assert.equal(limit, 1, 'said once')
  assert.ok(ticks.length >= 2 && ticks.every((t) => t >= 0 && t <= 450), ticks.join(','))
  const out = await c.stop()
  assert.equal(out.durationMs, 450, 'never longer than the limit')
})

test('finishing a recording makes it ready to send, or says why it cannot be', async () => {
  const f = fakeEnv()
  const c = await startRecording(f.env)
  await new Promise((r) => setTimeout(r, MIN_VOICE_MS + 50))
  const a = await finishRecording(c, f.env)
  assert.equal(a.dataURL, OK_URL)
  assert.equal(a.mime, 'audio/webm;codecs=opus')
  assert.ok(a.durationMs >= MIN_VOICE_MS)
  // a slip of the finger
  const c2 = await startRecording(f.env)
  await assert.rejects(() => finishRecording(c2, f.env), (e) => e.code === 'short')
})

test('a recording whose data cannot be read is a failure, and a too-big one is "big"', async () => {
  await assert.rejects(() => blobToDataURL({}, { FileReader: class { readAsDataURL() { setTimeout(() => this.onerror?.(), 0) } } }), (e) => e.code === 'failed')
  await assert.rejects(() => blobToDataURL({}, {}), (e) => e.code === 'failed')
  const f = fakeEnv()
  f.env.FileReader = class { readAsDataURL() { setTimeout(() => { this.result = 'data:audio/webm;base64,' + 'A'.repeat(MAX_VOICE_CHARS); this.onload?.() }, 0) } }
  const c = await startRecording(f.env)
  await new Promise((r) => setTimeout(r, MIN_VOICE_MS + 50))
  await assert.rejects(() => finishRecording(c, f.env), (e) => e.code === 'big')
})

// ---------- forwarding and saving one ----------

const voiceMsg = { id: 'v1', author: { uid: 'u1', name: 'Ana' }, text: '', audioURL: OK_URL, audioMeta: { durationMs: 7400, mime: 'audio/webm;codecs=opus' } }

test('a voice message can be forwarded, and the copy carries the recording', () => {
  assert.equal(canForward(voiceMsg), true)
  assert.equal(canForward({ text: '', audioURL: 'https://x.test/a.webm' }), false, 'an unplayable one is nothing to forward')
  const p = forwardPayload(voiceMsg, { u1: { name: 'Ana Reyes' } })
  assert.deepEqual(p.audio, { dataURL: OK_URL, durationMs: 7400, mime: 'audio/webm;codecs=opus' })
  assert.equal(p.text, '')
  assert.equal(p.forwardedFrom.name, 'Ana Reyes')
})

test('a message with no voice message has no audio in its copy', () => {
  assert.equal(forwardPayload({ id: 'm', text: 'hi', author: { uid: 'u1' } }, {}).audio, null)
  assert.equal(forwardPayload({ ...voiceMsg, audioMeta: { mime: 5 } }, {}).audio.mime, null)
})

test('the preview of a voice message says so', () => {
  assert.equal(forwardPreview(voiceMsg), '[voice message]')
  assert.equal(forwardPreview({ text: '', imageURL: 'data:x' }), '[image]')
})

// ---------- wired together ----------

test('sending stores the recording, checks it, and a normal message stores none', () => {
  const d = read('src/lib/db.js')
  assert.ok(d.includes("import { isPlayableAudioURL } from './voiceMessage'"))
  assert.ok(d.includes('if (!trimmed && !imageFile && !directImageURL && !audio) return'))
  assert.ok(d.includes('if (audio && !isPlayableAudioURL(audio.dataURL)) throw new Error('))
  assert.ok(d.includes('audioURL: audio ? audio.dataURL : null,'))
  assert.ok(d.includes("audioMeta: audio ? { durationMs: Math.round(Number(audio.durationMs) || 0), mime: typeof audio.mime === 'string' ? audio.mime : null } : null,"))
  assert.ok(d.includes("replyTo.audioURL ? '[voice message]'"))
  assert.ok(d.includes("(audio ? '🎤 Voice message' : '📷 Image')"))
  assert.ok(d.indexOf('isPlayableAudioURL(audio.dataURL)') < d.indexOf('await setDoc(msgRef'), 'checked before anything is written')
})

test('saving a voice message to notes keeps the recording', () => {
  const d = read('src/lib/db.js')
  assert.ok(d.includes('audioURL: payload.audio ? payload.audio.dataURL : null,'))
  assert.ok(d.includes('audioMeta: payload.audio ? { durationMs: payload.audio.durationMs, mime: payload.audio.mime } : null,'))
})

test('the chat passes the recording on to the send', () => {
  const s = read('src/components/ChatSurface.jsx')
  assert.ok(s.includes('const onSend = async ({ text, imageFile, imageURL, imageMeta, audio, followUp = false }) => {'))
  assert.ok(s.includes('imageMeta, audio, author: profile, replyTo: followUp ? null : replyingTo'))
})

test('the list plays only what audioOf accepts, once per message', () => {
  const l = read('src/components/MessageList.jsx')
  assert.ok(l.includes("import { audioOf } from '../lib/voiceMessage'"))
  assert.ok(l.includes('const audio = useMemo(() => audioOf(message), [message])'))
  assert.ok(l.includes('{audio && <VoicePlayer audio={audio} />}'))
})

test('the player takes one recording at a time and plays nothing it was not given', () => {
  const p = read('src/components/VoicePlayer.jsx')
  assert.ok(p.includes('src={audio.url}'))
  assert.ok(p.includes('if (!el.paused) { el.pause(); return }'), 'a second press pauses')
  assert.ok(p.includes('onEnded={() => { setOn(false); setAt(0) }}'), 'at the end it goes back to the start')
  assert.ok(p.includes('useState(audio.durationMs / 1000)'), 'the stored length shows before the file says its own')
  assert.ok(p.includes('if (Number.isFinite(d) && d > 0) setTotal(d)'), 'but an unknown length from the file does not replace it')
  assert.ok(p.includes('onChange={(e) => { const v = Number(e.target.value); setAt(v); if (ref.current) ref.current.currentTime = v }}'), 'dragging moves the playback')
  assert.ok(p.includes('{failed ? "Can\'t play" : label}'), 'a recording that will not play says so')
  assert.ok(p.includes('if (playing && playing !== el) playing.pause()'))
  assert.ok(p.includes('useEffect(() => () => { if (playing === ref.current) playing = null }, [])'))
  assert.ok(p.includes("onError={() => setFailed(true)}"))
  assert.ok(p.includes('try { await el.play() } catch { setFailed(true); setOn(false) }'))
  assert.ok(p.includes("aria-label=\"Position in the voice message\""))
})

test('the box shows a microphone only when nothing is written, and only where recording works', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes("const micOk = useMemo(() => typeof window !== 'undefined' && canRecord(window), [])"))
  assert.ok(c.includes('micOk && !text.trim() && files.length === 0 && !sending && !disabled'))
  assert.ok(c.includes('title="Record a voice message"'))
})

test('the microphone is released however the box goes away or the conversation changes', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('useEffect(() => () => { recRef.current?.cancel(); recRef.current = null }, [])'))
  assert.ok(c.includes('cancelVoice() // a recording belongs to the conversation it was started in'))
  assert.ok(c.includes('function cancelVoice() {\n    recRef.current?.cancel()\n    recRef.current = null\n    setVoice(null)\n  }'))
})

test('sending a recording finishes it first, and is not sent into a conversation it was not made in', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('const audio = await finishRecording(rec, window)'))
  assert.ok(c.includes('if (keyRef.current !== sentKey) return // moved to another conversation meanwhile'))
  assert.ok(c.includes("await onSend({ text: '', audio })"))
  assert.ok(c.indexOf('finishRecording(rec, window)') < c.indexOf("onSend({ text: '', audio })"))
  assert.ok(c.includes('recRef.current = null\n    const sentKey = keyRef.current'), 'a second press does not send it twice')
})

test('the time limit sends what was recorded, and a failure tells the person in words', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('onLimit: () => sendVoiceRef.current?.(),'))
  assert.ok(c.includes('sendVoiceRef.current = sendVoice'))
  assert.ok(c.includes('setError(voiceErrorText(err?.code))'))
  assert.ok(c.includes("if (err?.code !== 'cancelled')"))
})

test('while recording the person sees the time, can cancel, and can send, and cannot start a second', () => {
  const c = read('src/components/Composer.jsx')
  assert.ok(c.includes('{formatDuration(voice.ms)} / {formatDuration(MAX_VOICE_MS)}'))
  assert.ok(c.includes("onClick={cancelVoice} disabled={voice.phase === 'sending'}"), 'it cannot be cancelled while it is being sent')
  assert.ok(c.includes("onTick: (ms) => setVoice(v => (v && v.phase === 'recording' ? { ...v, ms } : v)),"), 'the clock moves, and only while recording')
  assert.ok(c.includes("<div ref={emojiBtnRef} className={'relative shrink-0 flex items-center' + (voice ? ' hidden' : '')}>"), 'the emoji button is out of the way while recording')
  assert.ok(c.includes('onClick={sendVoice} disabled={voice.phase !== \'recording\'}'))
  assert.ok(c.includes('if (voice || sending || disabled) return'))
  assert.ok(c.includes("<div className={'relative flex-1' + (voice ? ' hidden' : '')}>"), 'the text box is kept, not thrown away, while recording')
})

// ---------- the edges of the recorder ----------

test('it asks the recorder for a piece every quarter second, so a long recording is never one lump', async () => {
  const f = fakeEnv()
  const c = await startRecording(f.env)
  assert.equal(f.made[0].slice, 250)
  await c.stop()
})

test('empty pieces and pieces with no data are not kept', async () => {
  const f = fakeEnv({ emit: [{ size: 0 }, { data: null }, undefined, { data: { size: 0 } }, { data: { size: 7, tag: 'a' } }, { data: { size: 3, tag: 'b' } }] })
  const c = await startRecording(f.env)
  const out = await c.stop()
  assert.deepEqual(out.blob.parts.map((p) => p.tag), ['a', 'b'])
})

test('once stopped the clock stops: no more ticks arrive', async () => {
  const f = fakeEnv()
  const ticks = []
  const c = await startRecording(f.env, { onTick: (ms) => ticks.push(ms) })
  await new Promise((r) => setTimeout(r, 250))
  await c.stop()
  const n = ticks.length
  assert.ok(n >= 1, 'it ticked while recording')
  await new Promise((r) => setTimeout(r, 450))
  assert.equal(ticks.length, n, 'and not after')
})

test('cancelling stops the clock and stops the recorder once, even if stop() was never asked for', async () => {
  const f = fakeEnv()
  const ticks = []
  const c = await startRecording(f.env, { onTick: (ms) => ticks.push(ms) })
  c.cancel()
  const n = ticks.length
  await new Promise((r) => setTimeout(r, 450))
  assert.equal(ticks.length, n, 'no ticks after a cancel')
  assert.equal(f.made[0].stops, 1, 'the recorder was told to stop')
  assert.equal(f.made[0].state, 'inactive')
})

test('a cancel after stop() does not stop the recorder a second time', async () => {
  const f = fakeEnv()
  const c = await startRecording(f.env)
  const p = c.stop()
  c.cancel()
  await assert.rejects(() => p, (e) => e.code === 'cancelled')
  assert.equal(f.made[0].stops, 1)
})

test('a recorder that has already stopped by itself still gives what it has and turns the microphone off', async () => {
  const f = fakeEnv()
  const c = await startRecording(f.env)
  f.made[0].kill()
  const out = await c.stop()
  assert.equal(f.made[0].stops || 0, 0, 'it was not told to stop again')
  assert.ok(out.blob)
  assert.deepEqual(f.tracksLog, ['stopped', 'stopped'])
})

test('at the limit it stops once, and stop() then gives the same recording', async () => {
  const f = fakeEnv()
  let limit = 0
  const c = await startRecording(f.env, { maxMs: 250, onLimit: () => { limit++ } })
  await new Promise((r) => setTimeout(r, 900))
  assert.equal(limit, 1, 'said once, not on every tick after')
  assert.equal(f.made[0].stops, 1, 'the recorder stopped by itself')
  assert.deepEqual(f.tracksLog, ['stopped', 'stopped'], 'and the microphone is off')
  assert.equal((await c.stop()).durationMs, 250)
})

test('cancelling turns the microphone off even if the recorder never says it has stopped', async () => {
  const f = fakeEnv({ hangs: true })
  const c = await startRecording(f.env)
  c.cancel()
  assert.deepEqual(f.tracksLog, ['stopped', 'stopped'])
})

test('with every format on offer it records as AAC in MP4, the one an iPhone can play', async () => {
  const f = fakeEnv({ supported: ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2'] })
  const c = await startRecording(f.env)
  assert.equal(f.made[0].options.mimeType, 'audio/mp4;codecs=mp4a.40.2')
  await c.stop()
})
