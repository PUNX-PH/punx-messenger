// Voice messages: the limits, what a stored one has to look like to be played, and how a
// length reads. Pure, so it is tested. (Recording itself is voiceRecorder.js.)
//
// Like pictures, a voice message is kept inside the message's own document, as a data: address
// (Firestore holds a document up to 1 MiB, and the app has no file storage). That sets the size:
// speech at 16 kbit/s is about 120 KB a minute before it is written out as text (a third more),
// so a minute stays well inside the limit and loads with the message, with nothing else to fetch.

/** The longest recording, in milliseconds. Recording stops by itself here. */
export const MAX_VOICE_MS = 60_000

/** Shorter than this is a slip of the finger, not a message. */
export const MIN_VOICE_MS = 700

/** Bits per second to record at: plenty for speech, and what keeps a minute small. */
export const VOICE_BITS_PER_SECOND = 16_000

/** The most characters of data: address a voice message may have (leaves room in the 1 MiB document for the rest of it). */
export const MAX_VOICE_CHARS = 700_000

// What a browser may be asked to record as, best first. MP4 with AAC comes first because it is the
// one format every phone plays: an iPhone cannot play WebM or Ogg, so a recording made as WebM in
// Chrome would be silent for the person it is sent to. It is asked for by its codec, because plain
// 'audio/mp4' is answered with Opus inside MP4 by Chrome, which is not what an iPhone plays. Safari
// and Chrome (since version 126) can make AAC; Firefox cannot, and falls back to Opus in WebM or
// Ogg. Plain 'audio/mp4' is the last resort, for a Safari that does not know the codec spelling.
const MIME_CHOICES = ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']

/** The first of the formats above that `isSupported(type)` accepts, or '' to let the browser choose. */
export function pickMimeType(isSupported) {
  for (const t of MIME_CHOICES) {
    try { if (isSupported(t)) return t } catch { /* try the next */ }
  }
  return ''
}

// Only these, only as an address that holds the data itself: a voice message from someone else is
// never fetched from anywhere, so one cannot be made to ring a stranger's server when it is shown.
const AUDIO_URL = /^data:audio\/(webm|ogg|mp4|mpeg|aac|wav|x-m4a)(;codecs=[A-Za-z0-9.,+-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/

/** Is this an address a voice message may play from? */
export function isPlayableAudioURL(url) {
  return typeof url === 'string' && url.length <= MAX_VOICE_CHARS && AUDIO_URL.test(url)
}

/** A length in milliseconds as 0:07 or 1:05. Rounds to the nearest second; nonsense reads 0:00. */
export function formatDuration(ms) {
  const n = Number(ms)
  const total = Number.isFinite(n) && n > 0 ? Math.round(n / 1000) : 0
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The voice message on a message, as it may be shown: { url, durationMs } or null. Safe to call on
 * anybody's message (any member can write anything into one): the address must be a plain audio
 * data: address, and the length a number inside the limit (an unusable one reads as unknown, 0).
 */
export function audioOf(message) {
  const url = message?.audioURL
  if (!isPlayableAudioURL(url)) return null
  const d = Number(message?.audioMeta?.durationMs)
  const durationMs = Number.isFinite(d) && d > 0 ? Math.min(Math.round(d), MAX_VOICE_MS) : 0
  return { url, durationMs }
}

/**
 * May this recording be sent? 'ok', or why not: 'short', 'long' (over the limit; a recording stops at
 * the limit by itself, so this guards the rest) or 'big' (too large for a message).
 */
export function checkRecording({ durationMs, dataURL }) {
  if (!(Number(durationMs) >= MIN_VOICE_MS)) return 'short'
  if (Number(durationMs) > MAX_VOICE_MS + 1500) return 'long'
  if (!isPlayableAudioURL(dataURL)) return 'big'
  return 'ok'
}

/** What to tell the person for each reason a recording could not be made or sent. */
export function voiceErrorText(code) {
  switch (code) {
    case 'denied': return 'Allow the microphone in your browser to record a voice message.'
    case 'no-mic': return "No microphone was found."
    case 'unsupported': return "This browser can't record voice messages."
    case 'short': return 'That was too short. Hold on a little longer.'
    case 'long': return 'That was too long to send.'
    case 'big': return 'That recording is too big to send. Try a shorter one.'
    default: return "Couldn't record that. Try again."
  }
}
