import { useEffect, useRef, useState } from 'react'
import { useVoiceChannel } from '../../lib/useVoiceChannel'

/**
 * Persistent "you're connected to a voice channel" bar — Discord-style.
 * Rendered as a sibling of the sidebar in AppShell.jsx (not inside
 * ChannelSidebar) so it survives navigating to DMs and back, matching the
 * "voice persists across navigation" decision in the voice-channels plan.
 *
 * Also the audio sink: each remote participant's stream is played through a
 * hidden <audio> element here, since Phase A has no video tiles to attach
 * streams to.
 */
export default function VoiceStatusBar() {
  const {
    activeChannel, participants, remoteStreams, muted, connError,
    leave, toggleMute, clearConnError,
  } = useVoiceChannel()

  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const audioElsRef = useRef({})

  useEffect(() => {
    Object.entries(remoteStreams).forEach(([uid, stream]) => {
      const el = audioElsRef.current[uid]
      if (!el) return
      el.srcObject = stream
      el.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true))
    })
  }, [remoteStreams])

  if (!activeChannel) return null

  const unlockAudio = () => {
    Object.values(audioElsRef.current).forEach(el => el?.play().catch(() => {}))
    setAutoplayBlocked(false)
  }

  const count = participants.length

  return (
    <div className="shrink-0 border-t border-line-subtle bg-bg-dark px-2 py-2 relative">
      {Object.entries(remoteStreams).map(([uid, stream]) => (
        <audio
          key={uid}
          ref={el => { if (el) audioElsRef.current[uid] = el }}
          autoPlay
          playsInline
        />
      ))}

      {connError && (
        <div
          onClick={clearConnError}
          className="absolute bottom-full left-2 right-2 mb-1 bg-bad/90 text-white text-xs px-2 py-1.5 rounded-md cursor-pointer"
        >
          {connError}
        </div>
      )}

      {autoplayBlocked && (
        <button
          onClick={unlockAudio}
          className="w-full mb-1.5 text-xs bg-brand text-white px-2 py-1 rounded-md"
        >
          Tap to enable audio
        </button>
      )}

      <div className="flex items-center gap-2 px-1">
        <VoiceIcon className="text-ok shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink truncate">{activeChannel.channelName}</div>
          <div className="text-xs text-ink-dim">{count} {count === 1 ? 'person' : 'people'} connected</div>
        </div>
        <button
          type="button"
          onClick={toggleMute}
          title={muted ? 'Unmute' : 'Mute'}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className={[
            'w-8 h-8 rounded-full grid place-items-center transition-colors shrink-0',
            muted ? 'bg-bad text-white' : 'bg-bg-raised text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          {muted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button
          type="button"
          onClick={leave}
          title="Disconnect"
          aria-label="Disconnect"
          className="w-8 h-8 rounded-full grid place-items-center bg-bg-raised text-ink-muted hover:bg-bad hover:text-white transition-colors shrink-0"
        >
          <HangupIcon />
        </button>
      </div>
    </div>
  )
}

function VoiceIcon({ className = '' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}

function HangupIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(135deg)' }} aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  )
}
