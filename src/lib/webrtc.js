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

// audioDeviceId is optional — omitting it keeps the exact prior behavior
// (browser default device), which is all the 1:1 call system ever passes.
// Only lib/useVoiceChannel.jsx's input-device picker uses it.
export async function getLocalStream({ audio = true, video = true, audioDeviceId } = {}) {
  const audioConstraint = !audio ? false : (audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true)
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
