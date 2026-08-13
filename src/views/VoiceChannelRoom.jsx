import { useEffect, useRef } from 'react'
import { useVoiceChannel } from '../lib/useVoiceChannel'
import { useUsers } from '../lib/users'
import Avatar from '../components/Avatar'

// Deterministic pastel background per person (Discord's own avatar-tile
// placeholders are colored per-user the same way) — just a cheap string
// hash into a hue, no need for anything fancier.
function colorFromName(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${hash % 360}, 45%, 32%)`
}

/**
 * The voice channel's own main-content view — this is what makes clicking a
 * voice channel behave like Discord: it navigates here (see ChannelSidebar's
 * SortableChannelRow), showing a tile per participant instead of a text
 * message list. Audio-only participants get an avatar on a colored
 * placeholder tile; camera/screen-share participants get real video. Voice
 * still isn't required to stay on this route (see useVoiceChannel's "persists
 * across navigation") — navigate to a text channel or DM and the connection
 * (and controls in VoiceStatusBar/UserPanel) keeps going, you just won't see
 * this tile grid until you come back.
 */
export default function VoiceChannelRoom({ channel, groupId }) {
  const {
    activeChannel, participants, remoteStreams, speakingUids, myUid,
    cameraOn, screenSharing, localVideoStream, joining, join,
  } = useVoiceChannel()
  const { byId } = useUsers()

  const isThisChannel = activeChannel?.groupId === groupId && activeChannel?.channelId === channel.id

  if (!isThisChannel) {
    return (
      <div className="flex-1 grid place-items-center bg-bg-main">
        <div className="flex flex-col items-center gap-4">
          <div className="text-lg font-semibold text-ink">{channel.name}</div>
          <button
            type="button"
            onClick={() => join(groupId, channel.id, channel.name)}
            disabled={joining}
            className="px-6 py-2.5 rounded-full bg-brand text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {joining ? 'Joining…' : `Join ${channel.name}`}
          </button>
        </div>
      </div>
    )
  }

  const tiles = participants.map(p => {
    const isSelf = p.uid === myUid
    const user = byId[p.uid]
    return {
      uid: p.uid,
      name: isSelf ? 'You' : (user?.name || 'Someone'),
      photoURL: user?.photoURL,
      speaking: speakingUids?.has(p.uid),
      muted: p.muted,
      hasVideo: isSelf ? (cameraOn || screenSharing) : (p.cameraOn || p.screenSharing),
      isScreen: isSelf ? screenSharing : p.screenSharing,
      stream: isSelf ? localVideoStream : remoteStreams[p.uid],
      isSelf,
    }
  })

  return (
    <div className="flex-1 flex flex-col bg-bg-main min-w-0">
      <div className="h-12 px-4 flex items-center gap-2 border-b border-line-subtle shrink-0">
        <VoiceIcon className="text-ink-dim shrink-0" />
        <span className="font-semibold truncate">{channel.name}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {/* flex-wrap, not a stretchy grid — a grid's `1fr` tracks stretch to
            fill the row even with just one or two tiles, which is why a
            single person used to render as one giant box. Fixed-size boxes
            that wrap keep everyone the same small size regardless of count;
            only screen-share gets to be bigger, since that's the thing
            people are actually trying to read. */}
        <div className="flex flex-wrap content-start gap-3">
          {tiles.map(t => <ParticipantTile key={t.uid} {...t} />)}
        </div>
      </div>
    </div>
  )
}

function ParticipantTile({ name, photoURL, speaking, muted, hasVideo, isScreen, stream, isSelf }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = hasVideo ? (stream || null) : null
  }, [stream, hasVideo])

  return (
    <div
      className={[
        'relative rounded-xl overflow-hidden bg-bg-raised flex items-center justify-center transition-shadow shrink-0',
        // Screen-share stays big (the whole point is reading it); camera
        // and audio-only tiles are small fixed boxes, same size either way.
        isScreen ? 'w-full max-w-2xl aspect-video' : 'w-56 h-40',
        speaking ? 'ring-2 ring-ok' : '',
      ].join(' ')}
    >
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={isSelf} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center" style={{ background: colorFromName(name) }}>
          <Avatar name={name} src={photoURL} size={64} />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 rounded px-2 py-1 max-w-[calc(100%-1rem)]">
        {muted && <MicOffIcon className="text-bad shrink-0" />}
        {isScreen && <ScreenIcon className="text-white shrink-0" />}
        <span className="text-xs text-white truncate">{name}</span>
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

function MicOffIcon({ className = '' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
    </svg>
  )
}

function ScreenIcon({ className = '' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}
