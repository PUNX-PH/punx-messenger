// Recording a voice message from the microphone. Everything the browser provides is passed in
// (`env`, the page's globals by default), so the logic is tested with stand-ins.
//
// The one thing that must never go wrong is the microphone staying on: every way out of a
// recording (sent, cancelled, ran out of time, failed) stops every track, and the browser's
// "this page is using your microphone" light goes off.

import { MAX_VOICE_MS, VOICE_BITS_PER_SECOND, checkRecording, pickMimeType } from './voiceMessage.js'

/** An error with a `code` that voiceErrorText() turns into words. */
export class VoiceError extends Error {
  constructor(code, cause) {
    super(code)
    this.name = 'VoiceError'
    this.code = code
    if (cause) this.cause = cause
  }
}

const stopTracks = (stream) => { try { stream?.getTracks?.().forEach((t) => { try { t.stop() } catch { /* already stopped */ } }) } catch { /* nothing to stop */ } }

/** Is recording possible here at all? (Checked before showing a microphone button.) */
export function canRecord(env = globalThis) {
  return typeof env.navigator?.mediaDevices?.getUserMedia === 'function' && typeof env.MediaRecorder === 'function'
}

/**
 * Turns on the microphone and starts recording. Resolves to a controller once recording has begun:
 *   stop()    -> Promise<{ blob, durationMs, mime }>   finishes and releases the microphone
 *   cancel()  -> void                                  throws the recording away and releases it
 * Rejects with a VoiceError ('unsupported', 'denied', 'no-mic', 'failed').
 * `onTick(ms)` is called about every 200 ms with the time so far. At `maxMs` the recording stops
 * by itself and `onLimit()` is called, so the caller can send or show what it has (stop() then
 * returns it).
 */
export async function startRecording(env = globalThis, { maxMs = MAX_VOICE_MS, onTick, onLimit } = {}) {
  if (!canRecord(env)) throw new VoiceError('unsupported')

  let stream
  try {
    stream = await env.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    const name = e?.name
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') throw new VoiceError('denied', e)
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') throw new VoiceError('no-mic', e)
    throw new VoiceError('failed', e)
  }

  let recorder
  const chunks = []
  let startedAt = 0
  let timer = null
  let finished = null // the promise stop() returns, once asked
  let cancelled = false

  const mime = pickMimeType((t) => env.MediaRecorder.isTypeSupported?.(t))
  try {
    recorder = new env.MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: VOICE_BITS_PER_SECOND } : { audioBitsPerSecond: VOICE_BITS_PER_SECOND })
  } catch (e) {
    stopTracks(stream)
    throw new VoiceError('failed', e)
  }

  const clear = () => { if (timer !== null) { clearInterval(timer); timer = null } }
  const finish = () => {
    if (finished) return finished
    clear()
    finished = new Promise((resolve, reject) => {
      const durationMs = Math.max(0, Date.now() - startedAt)
      recorder.onstop = () => {
        stopTracks(stream)
        if (cancelled) return reject(new VoiceError('cancelled'))
        const type = recorder.mimeType || mime || 'audio/webm'
        resolve({ blob: new env.Blob(chunks, { type }), durationMs: Math.min(durationMs, maxMs), mime: type })
      }
      recorder.onerror = (e) => { stopTracks(stream); reject(new VoiceError('failed', e?.error ?? e)) }
      try { recorder.state === 'inactive' ? recorder.onstop() : recorder.stop() } catch (e) { stopTracks(stream); reject(new VoiceError('failed', e)) }
    })
    return finished
  }

  recorder.ondataavailable = (e) => { if (e?.data && e.data.size > 0) chunks.push(e.data) }
  try {
    startedAt = Date.now()
    recorder.start(250)
  } catch (e) {
    stopTracks(stream)
    throw new VoiceError('failed', e)
  }

  timer = setInterval(() => {
    const ms = Date.now() - startedAt
    onTick?.(Math.min(ms, maxMs))
    if (ms >= maxMs) {
      // out of time: stop here (once), and let the caller send or show what there is
      finish().catch(() => {})
      onLimit?.()
    }
  }, 200)

  return {
    stop: () => finish(),
    cancel: () => {
      cancelled = true
      if (!finished) finish().catch(() => {})
      stopTracks(stream)
    },
  }
}

/** A blob as a data: address. Rejects with a VoiceError('failed') if it cannot be read. */
export function blobToDataURL(blob, env = globalThis) {
  return new Promise((resolve, reject) => {
    try {
      const r = new env.FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = () => reject(new VoiceError('failed'))
      r.readAsDataURL(blob)
    } catch (e) { reject(new VoiceError('failed', e)) }
  })
}

/**
 * Finishes a recording and makes it ready to send: { dataURL, durationMs, mime }. Rejects with a
 * VoiceError whose code says why it cannot be sent ('short', 'long', 'big', 'failed').
 */
export async function finishRecording(controller, env = globalThis) {
  const { blob, durationMs, mime } = await controller.stop()
  const dataURL = await blobToDataURL(blob, env)
  const verdict = checkRecording({ durationMs, dataURL })
  if (verdict !== 'ok') throw new VoiceError(verdict)
  return { dataURL, durationMs, mime }
}
