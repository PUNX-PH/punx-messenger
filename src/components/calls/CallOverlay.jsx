import { useEffect, useRef, useState } from 'react'
import Avatar from '../Avatar'
import { useUsers } from '../../lib/users'
import { useCall } from '../../lib/useCall'

/**
 * In-call UI: outgoing-ringing card or connected video tiles + controls.
 * NOT Modal-based on purpose — it must survive route navigation and must
 * not dismiss on a stray click.
 *
 * Mounted inside AppShell's main-content area (not App.jsx) specifically so
 * `absolute inset-0` here confines it to the messaging pane — the rail and
 * sidebar stay visible, Discord-style — with an explicit fullscreen toggle
 * for anyone who wants the old cover-the-viewport behavior back.
 */
export default function CallOverlay() {
  const {
    call, status, myUid, localStream, remoteStream, muted, cameraOff,
    connError, iceState, endActiveCall, toggleMute, toggleCamera, addVideo,
  } = useCall()
  const { byId } = useUsers()

  const [fullscreen, setFullscreen] = useState(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)

  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const remoteAudioRef = useRef(null)

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream || null
  }, [localStream])

  // Explicit .play() (rather than relying only on the `autoPlay` attribute)
  // so a browser autoplay-policy rejection is something we can detect and
  // recover from, instead of silently having no sound with no indication
  // why. A click on the "tap to enable audio" button below always succeeds,
  // since a click is itself the user gesture autoplay policies require.
  useEffect(() => {
    const el = remoteVideoRef.current
    if (!el) return
    el.srcObject = remoteStream || null
    if (remoteStream) el.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true))
  }, [remoteStream])

  // Remote audio needs to play even when we're not showing the remote
  // <video> (audio-only calls, or a video call before it's connected) —
  // otherwise the incoming WebRTC audio track just arrives and is never
  // routed to an actual playback element. Only one of these two elements is
  // ever mounted at a time (see the ternary below), so this never doubles
  // up with the <video> element's own audio once that takes over.
  useEffect(() => {
    const el = remoteAudioRef.current
    if (!el) return
    el.srcObject = remoteStream || null
    if (remoteStream) el.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true))
  }, [remoteStream])

  if (status !== 'outgoing' && status !== 'connected') return null

  const otherUid = call.callerUid === myUid ? call.calleeUid : call.callerUid
  const other = byId[otherUid]
  const isVideoCall = call.type === 'video'
  const showRemoteVideo = isVideoCall && status === 'connected'
  // Signaling says "connected" (call doc accepted), but that's separate
  // from whether the actual peer-to-peer media path came up — a call stuck
  // here past 'checking'/'new' without ever reaching 'connected'/'completed'
  // is the classic symptom of STUN-only ICE failing to traverse a
  // restrictive NAT/firewall (see lib/webrtc.js's getIceServers() for where
  // a TURN relay would go).
  const mediaConnecting = status === 'connected' && !['connected', 'completed'].includes(iceState)

  const unlockAudio = () => {
    remoteVideoRef.current?.play().catch(() => {})
    remoteAudioRef.current?.play().catch(() => {})
    setAutoplayBlocked(false)
  }

  return (
    <div className={[
      fullscreen ? 'fixed inset-0' : 'absolute inset-0',
      'z-[70] bg-black/95 flex flex-col',
    ].join(' ')}>
      <div className="flex-1 relative overflow-hidden">
        {showRemoteVideo ? (
          <video ref={remoteVideoRef} playsInline className="w-full h-full object-cover bg-black" />
        ) : (
          <div className="w-full h-full grid place-items-center">
            <div className="flex flex-col items-center gap-4">
              <Avatar name={other?.name} src={other?.photoURL} size={96} />
              <div className="text-lg font-semibold text-white">{other?.name || 'Calling…'}</div>
              <div className="text-sm text-white/60">
                {status !== 'connected' ? 'Ringing…' : mediaConnecting ? 'Connecting audio…' : 'Voice call connected'}
              </div>
            </div>
            <audio ref={remoteAudioRef} />
          </div>
        )}

        {isVideoCall && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-4 right-4 w-40 h-28 object-cover rounded-lg border border-white/20 bg-black shadow-elev2"
          />
        )}

        <button
          onClick={() => setFullscreen(f => !f)}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          className="absolute top-4 right-4 p-2 rounded-md bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-colors"
        >
          {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
        </button>

        {autoplayBlocked && (
          <button
            onClick={unlockAudio}
            className="absolute top-4 left-1/2 -translate-x-1/2 bg-brand text-white text-sm font-medium px-4 py-2 rounded-md shadow-elev2"
          >
            Tap to enable audio
          </button>
        )}

        {!autoplayBlocked && mediaConnecting && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-warn/90 text-white text-sm px-4 py-2 rounded-md max-w-sm text-center">
            Still connecting — if this doesn't resolve, the network on one side may be blocking the direct connection.
          </div>
        )}

        {connError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-bad/90 text-white text-sm px-4 py-2 rounded-md">
            {connError}
          </div>
        )}
      </div>

      <div className="h-20 shrink-0 flex items-center justify-center gap-4 bg-black/60">
        <ControlButton onClick={toggleMute} active={muted} label={muted ? 'Unmute' : 'Mute'}>
          {muted ? <MicOffIcon /> : <MicIcon />}
        </ControlButton>
        {isVideoCall ? (
          <ControlButton onClick={toggleCamera} active={cameraOff} label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
            {cameraOff ? <VideoOffIcon /> : <VideoIcon />}
          </ControlButton>
        ) : status === 'connected' && (
          <ControlButton onClick={addVideo} label="Turn on video">
            <VideoIcon />
          </ControlButton>
        )}
        <ControlButton onClick={endActiveCall} danger label="Hang up">
          <HangupIcon />
        </ControlButton>
      </div>
    </div>
  )
}

function ControlButton({ onClick, active, danger, label, children }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'w-12 h-12 rounded-full grid place-items-center transition-colors shrink-0',
        danger ? 'bg-bad text-white hover:opacity-90'
          : active ? 'bg-white text-black'
          : 'bg-white/15 text-white hover:bg-white/25',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}

function MicOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="23 7 16 12 23 17 23 7"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  )
}

function VideoOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1"/>
      <path d="M9 6h5a2 2 0 0 1 2 2v5"/>
      <polygon points="23 7 16 12 23 17 23 7"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

function HangupIcon() {
  // Same glyph as CallButtons' phone icon, rotated to the universal
  // "end call" orientation.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(135deg)' }} aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 3 21 3 21 9"/>
      <polyline points="9 21 3 21 3 15"/>
      <line x1="21" y1="3" x2="14" y2="10"/>
      <line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 14 10 14 10 20"/>
      <polyline points="20 10 14 10 14 4"/>
      <line x1="14" y1="10" x2="21" y2="3"/>
      <line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  )
}
