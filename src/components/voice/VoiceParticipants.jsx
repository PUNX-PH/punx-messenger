import { useEffect, useState } from 'react'
import { listenParticipants, pruneStaleParticipants } from '../../lib/voiceChannel'
import { useUsers } from '../../lib/users'
import { useVoiceChannel } from '../../lib/useVoiceChannel'
import Avatar from '../Avatar'

// Runs for anyone with this sidebar open (in voice or not) so a roster doc
// abandoned by a crashed tab still gets cleaned up even if nobody currently
// in the channel happens to be mid-heartbeat — see lib/voiceChannel.js.
const PRUNE_INTERVAL_MS = 30_000

// Beyond this many people, drop the name+row layout and fall back to a
// compact wrapped stack of avatars only — keeps a busy voice channel from
// pushing the rest of the channel list off-screen.
const COMPACT_THRESHOLD = 5

/**
 * Discord-style roster rendered under a voice channel's row in
 * ChannelSidebar — avatar + name per participant, live, with a glowing
 * ring around whoever's currently talking (see useVoiceChannel's Web Audio
 * level detection).
 */
export default function VoiceParticipants({ groupId, channelId }) {
  const [participants, setParticipants] = useState([])
  const { byId } = useUsers()
  const { speakingUids } = useVoiceChannel()

  useEffect(() => {
    return listenParticipants(groupId, channelId, setParticipants, () => {})
  }, [groupId, channelId])

  useEffect(() => {
    const t = setInterval(() => pruneStaleParticipants(groupId, channelId), PRUNE_INTERVAL_MS)
    return () => clearInterval(t)
  }, [groupId, channelId])

  if (participants.length === 0) return null

  const compact = participants.length > COMPACT_THRESHOLD

  return (
    <div className={compact ? 'pl-7 pr-1 pb-1 pt-0.5 flex items-center gap-1.5 flex-wrap' : 'pl-7 pr-1 pb-1 pt-0.5 space-y-0.5'}>
      {participants.map(p => {
        const user = byId[p.uid]
        const speaking = speakingUids?.has(p.uid)
        const hasVideo = p.cameraOn || p.screenSharing
        return compact
          ? <CompactAvatar key={p.uid} user={user} muted={p.muted} deafened={p.deafened} speaking={speaking} hasVideo={hasVideo} />
          : <ParticipantRow key={p.uid} user={user} muted={p.muted} deafened={p.deafened} speaking={speaking} hasVideo={hasVideo} />
      })}
    </div>
  )
}

function ParticipantRow({ user, muted, deafened, speaking, hasVideo }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 min-w-0">
      <SpeakingAvatar user={user} size={20} speaking={speaking} muted={muted} deafened={deafened} hasVideo={hasVideo} />
      <span className="text-xs text-ink-muted truncate">{user?.name || 'Someone'}</span>
    </div>
  )
}

function CompactAvatar({ user, muted, deafened, speaking, hasVideo }) {
  return (
    <div title={user?.name || 'Someone'} className="shrink-0">
      <SpeakingAvatar user={user} size={16} speaking={speaking} muted={muted} deafened={deafened} hasVideo={hasVideo} />
    </div>
  )
}

function SpeakingAvatar({ user, size, speaking, muted, deafened, hasVideo }) {
  return (
    <div
      className={[
        'relative shrink-0 rounded-full transition-shadow duration-150',
        speaking ? 'ring-2 ring-ok ring-offset-1 ring-offset-bg-dark' : '',
      ].join(' ')}
    >
      <Avatar name={user?.name} src={user?.photoURL} size={size} />
      {hasVideo && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-ok grid place-items-center">
          <CameraDotIcon />
        </span>
      )}
      {(muted || deafened) && (
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-bad grid place-items-center">
          {deafened ? <DeafenedDotIcon /> : <MutedDotIcon />}
        </span>
      )}
    </div>
  )
}

function CameraDotIcon() {
  return (
    <svg width="7" height="7" viewBox="0 0 24 24" fill="white" stroke="none" aria-hidden="true">
      <polygon points="23 7 16 12 23 17 23 7"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  )
}

function MutedDotIcon() {
  return (
    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
    </svg>
  )
}

function DeafenedDotIcon() {
  return (
    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M3 18v-6a9 9 0 0 1 15.3-6.4" />
      <path d="M21 15.3V12a9 9 0 0 0-.7-3.5" />
    </svg>
  )
}
