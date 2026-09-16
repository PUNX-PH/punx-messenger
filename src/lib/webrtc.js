// Raw WebRTC plumbing — no Firestore or React knowledge here on purpose, so
// it stays swappable/testable independent of the signaling transport. See
// lib/calls.js for signaling and lib/useCall.js for the glue.

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

// ICE server list is env-driven so a TURN provider can be added later purely
// via deployment config — never hardcode TURN credentials in source.
// VITE_ICE_SERVERS, if set, must be a JSON array of RTCIceServer objects, e.g.
//   [{"urls":"stun:stun.l.google.com:19302"},
//    {"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]
export function getIceServers() {
  const raw = import.meta.env.VITE_ICE_SERVERS
  if (!raw) return DEFAULT_ICE_SERVERS
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_ICE_SERVERS
  } catch (e) {
    console.warn('[webrtc] VITE_ICE_SERVERS is not valid JSON, falling back to STUN-only:', e.message)
    return DEFAULT_ICE_SERVERS
  }
}

// TURN credentials, fetched once per session and reused.
//
// They cannot be a build-time constant like the STUN list above: the key that
// issues them must stay server-side, and what it issues expires. The Worker
// mints one per signed-in user against the Firebase ID token the client
// already holds — same route and same auth as the GIF proxy.
//
// The promise is cached rather than the value, so N peers joining at once
// share one request instead of racing N of them.
let icePromise = null

/**
 * Resolves the ICE server list to build peer connections with: STUN plus TURN
 * when the Worker can mint it, STUN alone when it cannot.
 *
 * Failure is deliberately quiet and non-fatal. No TURN means hard-to-reach
 * pairs fail to connect — which is exactly where this app was before TURN
 * existed — whereas throwing here would stop voice working for everybody,
 * including the majority who never need a relay.
 */
export async function resolveIceServers() {
  const base = getIceServers()
  // An explicit VITE_ICE_SERVERS is someone deliberately overriding the
  // config; don't second-guess it with a fetch.
  if (import.meta.env.VITE_ICE_SERVERS) return base

  const workerUrl = import.meta.env.VITE_GIFS_WORKER_URL
  if (!workerUrl) return base

  if (!icePromise) {
    icePromise = (async () => {
      const { auth } = await import('./firebase')
      const user = auth.currentUser
      if (!user) return base
      const res = await fetch(`${workerUrl}/turn/credentials`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      })
      if (!res.ok) throw new Error(`TURN request failed: ${res.status}`)
      const { iceServers } = await res.json()
      if (!Array.isArray(iceServers) || !iceServers.length) throw new Error('TURN returned nothing')
      // Keep STUN alongside: a direct path is always preferable to a relayed
      // one, and ICE will pick the relay only when it has to.
      return [...base, ...iceServers]
    })().catch(e => {
      console.warn('[webrtc] no TURN available, falling back to STUN-only:', e.message)
      icePromise = null // let a later join try again
      return base
    })
  }
  return icePromise
}

export function createPeerConnection(iceServers = getIceServers()) {
  return new RTCPeerConnection({ iceServers })
}

// audioDeviceId and audioProcessing are both optional — omitting them keeps
// the exact prior behavior (browser default device, browser default
// processing), which is all the 1:1 call system ever passes. Only
// lib/useVoiceChannel.jsx's device picker and mic-processing toggles use them.
//
// audioProcessing is a plain object of the standard WebRTC audio constraints
// — { noiseSuppression, echoCancellation, autoGainControl } — i.e. the same
// knobs behind Discord's own noise-suppression settings. They're passed as
// plain values rather than { exact: ... } on purpose: a browser that can't
// honour one should quietly ignore it, not fail the whole getUserMedia call
// and leave someone with no microphone at all.
export async function getLocalStream({ audio = true, video = true, audioDeviceId, audioProcessing } = {}) {
  let audioConstraint = false
  if (audio) {
    audioConstraint = {}
    if (audioDeviceId) audioConstraint.deviceId = { exact: audioDeviceId }
    if (audioProcessing) Object.assign(audioConstraint, audioProcessing)
    // Collapse back to the bare `true` every existing caller effectively asked
    // for when there's nothing to actually constrain.
    if (!Object.keys(audioConstraint).length) audioConstraint = true
  }
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video })
}

export function stopStream(stream) {
  stream?.getTracks().forEach(t => t.stop())
}

// Device labels are only populated once mic permission has been granted at
// least once this session (browser privacy rule) — fine here since this is
// only ever called from the voice settings popover, reachable only while
// already connected (so getUserMedia has already run).
export async function listAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return {
    inputs: devices.filter(d => d.kind === 'audioinput'),
    outputs: devices.filter(d => d.kind === 'audiooutput'),
  }
}
