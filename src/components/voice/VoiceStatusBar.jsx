import { forwardRef, useEffect, useRef, useState } from 'react'
import { useVoiceChannel } from '../../lib/useVoiceChannel'
import VoiceSettingsPopover from './VoiceSettingsPopover'

// Not every browser implements output-device routing (Safari doesn't) —
// feature-detect once rather than letting setSinkId throw per <audio> el.
const SUPPORTS_SINK_ID = typeof document !== 'undefined'
  && typeof document.createElement('audio').setSinkId === 'function'

/**
 * Persistent "you're connected to a voice channel" bar — Discord-style.
 * Rendered as a sibling of the sidebar in AppShell.jsx (not inside
 * ChannelSidebar) so it survives navigating to DMs and back, matching the
 * "voice persists across navigation" decision in the voice-channels plan.
 *
 * Also the audio sink: each remote participant's stream is played through a
 * hidden <audio> element here, since Phase A has no video tiles to attach
 * streams to. Output device/volume and deafen are all applied at this one
 * choke point — nothing about them touches the WebRTC layer.
 */
export default function VoiceStatusBar() {
  const {
    activeChannel, remoteStreams, muted, deafened, connError,
    voicePrefs, leave, toggleMute, toggleDeafen, clearConnError,
  } = useVoiceChannel()

  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const audioElsRef = useRef({})
  const gearBtnRef = useRef(null)

  useEffect(() => {
    Object.entries(remoteStreams).forEach(([uid, stream]) => {
      const el = audioElsRef.current[uid]
      if (!el) return
      el.srcObject = stream
      el.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true))
    })
  }, [remoteStreams])

  // Output device, output volume, and deafen all apply here — one loop over
  // whatever <audio> sinks currently exist, re-run whenever any of the three
  // (or the set of connected peers) changes.
  useEffect(() => {
    Object.values(audioElsRef.current).forEach(el => {
      if (!el) return
      el.volume = deafened ? 0 : voicePrefs.outputVolume
      // '' resets to the system default — needed so switching back to
      // "System default" in the popover actually takes effect, not just
      // picking a specific device.
      if (SUPPORTS_SINK_ID) el.setSinkId(voicePrefs.outputDeviceId || '').catch(() => {})
    })
  }, [deafened, voicePrefs.outputVolume, voicePrefs.outputDeviceId, remoteStreams])

  if (!activeChannel) return null

  const unlockAudio = () => {
    Object.values(audioElsRef.current).forEach(el => el?.play().catch(() => {}))
    setAutoplayBlocked(false)
  }

  return (
    <div className="shrink-0 border-t border-line-subtle bg-bg-dark px-2 py-1.5 relative">
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

      {settingsOpen && (
        <VoiceSettingsPopover anchorRef={gearBtnRef} onClose={() => setSettingsOpen(false)} />
      )}

      <div className="flex items-center gap-2 px-1">
        <VoiceIcon className="text-ok shrink-0" />
        {/* Participant count lives in VoiceParticipants' avatar stack under
            the channel row already — repeating it here was redundant. */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ok leading-tight">Voice Connected</div>
          <div className="text-sm text-ink truncate leading-tight">{activeChannel.channelName}</div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 px-1 mt-1">
        <IconButton onClick={toggleMute} active={muted} label={muted ? 'Unmute' : 'Mute'}>
          {muted ? <MicOffIcon /> : <MicIcon />}
        </IconButton>
        <IconButton onClick={toggleDeafen} active={deafened} label={deafened ? 'Undeafen' : 'Deafen'}>
          {deafened ? <DeafenedIcon /> : <HeadphonesIcon />}
        </IconButton>
        <IconButton ref={gearBtnRef} onClick={() => setSettingsOpen(v => !v)} active={settingsOpen} label="Voice settings">
          <GearIcon />
        </IconButton>
        <IconButton onClick={leave} label="Disconnect" danger>
          <HangupIcon />
        </IconButton>
      </div>
    </div>
  )
}

const IconButton = forwardRef(function IconButton({ onClick, active, danger, label, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'w-8 h-8 rounded-full grid place-items-center transition-colors shrink-0',
        danger ? 'bg-bg-raised text-ink-muted hover:bg-bad hover:text-white'
          : active ? 'bg-bad text-white'
          : 'bg-bg-raised text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
})

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

function HeadphonesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  )
}

function DeafenedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M3 18v-6a9 9 0 0 1 15.3-6.4" />
      <path d="M21 15.3V12a9 9 0 0 0-.7-3.5" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
