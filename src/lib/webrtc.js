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
