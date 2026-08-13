import { useEffect, useRef, useState } from 'react'
import { useVoiceChannel } from '../../lib/useVoiceChannel'

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
 * Mic/deafen/settings deliberately live in UserPanel instead of here — in
 * real Discord those three sit next to YOUR OWN avatar, not in the
 * "connected to channel X" row, which only carries channel info + leave.
 *
 * Also the audio sink: each remote participant's stream is played through a
 * hidden <audio> element here, since Phase A has no video tiles to attach
 * streams to. Output device/volume and deafen are all applied at this one
 * choke point — nothing about them touches the WebRTC layer.
 */
export default function VoiceStatusBar() {
  const { activeChannel, remoteStreams, deafened, connError, voicePrefs, leave, clearConnError } = useVoiceChannel()

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

      <div className="flex items-center gap-2 px-1">
        <VoiceIcon className="text-ok shrink-0" />
        {/* Participant count lives in VoiceParticipants' avatar stack under
            the channel row already — repeating it here was redundant. */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ok leading-tight">Voice Connected</div>
          <div className="text-sm text-ink truncate leading-tight">{activeChannel.channelName}</div>
        </div>
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

function HangupIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(135deg)' }} aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  )
}
