import { useEffect, useRef } from 'react'
import Avatar from '../Avatar'
import { useUsers } from '../../lib/users'
import { useCall } from '../../lib/useCall'

/**
 * Persistent in-call UI: outgoing-ringing card or connected video tiles +
 * controls. NOT Modal-based on purpose — it must survive route navigation
 * and must not dismiss on a stray click.
 */
export default function CallOverlay() {
  const {
    call, status, myUid, localStream, remoteStream, muted, cameraOff,
    connError, endActiveCall, toggleMute, toggleCamera,
  } = useCall()
  const { byId } = useUsers()

  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream || null
  }, [localStream])

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream || null
  }, [remoteStream])

  if (status !== 'outgoing' && status !== 'connected') return null

  const otherUid = call.callerUid === myUid ? call.calleeUid : call.callerUid
  const other = byId[otherUid]
  const isVideoCall = call.type === 'video'
  const showRemoteVideo = isVideoCall && status === 'connected'

  return (
    <div className="fixed inset-0 z-[70] bg-black/95 flex flex-col">
      <div className="flex-1 relative overflow-hidden">
        {showRemoteVideo ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover bg-black" />
        ) : (
          <div className="w-full h-full grid place-items-center">
            <div className="flex flex-col items-center gap-4">
              <Avatar name={other?.name} src={other?.photoURL} size={96} />
              <div className="text-lg font-semibold text-white">{other?.name || 'Calling…'}</div>
              <div className="text-sm text-white/60">
                {status === 'connected' ? 'Voice call connected' : 'Ringing…'}
              </div>
            </div>
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
        {isVideoCall && (
          <ControlButton onClick={toggleCamera} active={cameraOff} label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
            {cameraOff ? <VideoOffIcon /> : <VideoIcon />}
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
