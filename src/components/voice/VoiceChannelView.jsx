import { useEffect, useRef } from 'react'
import { useVoiceChannel } from '../../lib/useVoiceChannel'
import { useUsers } from '../../lib/users'

/**
 * Floating video tile strip — camera/screen-share tiles for whoever
 * currently has one on. Deliberately NOT a full-screen overlay like
 * CallOverlay (the 1:1 call view): voice channels are designed to not
 * interrupt using the rest of the app (see the voice-channels plan's
 * "persists across navigation" decision) — turning a camera on shouldn't
 * suddenly block reading a text channel underneath. Renders nothing at all
 * when nobody (including you) has video active.
 */
export default function VoiceChannelView() {
  const {
    activeChannel, participants, remoteStreams, myUid,
    cameraOn, screenSharing, localVideoStream,
  } = useVoiceChannel()
  const { byId } = useUsers()

  if (!activeChannel) return null

  const remoteTiles = participants
    .filter(p => p.uid !== myUid && (p.cameraOn || p.screenSharing))
    .map(p => ({ uid: p.uid, stream: remoteStreams[p.uid], name: byId[p.uid]?.name, isScreen: p.screenSharing }))

  const hasLocalVideo = cameraOn || screenSharing
  if (!hasLocalVideo && remoteTiles.length === 0) return null

  return (
    <div className="absolute bottom-4 right-4 z-30 flex flex-wrap justify-end gap-2 max-w-[calc(100%-2rem)] pointer-events-none">
      {hasLocalVideo && (
        <VideoTile stream={localVideoStream} name="You" muted isScreen={screenSharing} />
      )}
      {remoteTiles.map(t => (
        <VideoTile key={t.uid} stream={t.stream} name={t.name || 'Someone'} isScreen={t.isScreen} />
      ))}
    </div>
  )
}

function VideoTile({ stream, name, muted, isScreen }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null
  }, [stream])

  return (
    <div className="w-40 h-28 rounded-lg overflow-hidden bg-black relative shadow-elev2 pointer-events-auto">
      <video ref={videoRef} autoPlay playsInline muted={muted} className="w-full h-full object-cover" />
      <div className="absolute bottom-1 left-1.5 right-1.5 flex items-center gap-1 text-[11px] text-white/90">
        {isScreen && <ScreenIcon />}
        <span className="truncate drop-shadow">{name}</span>
      </div>
    </div>
  )
}

function ScreenIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}
