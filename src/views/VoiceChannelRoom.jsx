import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

// Document Picture-in-Picture is Chromium-only (Chrome/Edge 116+) — the same
// API Google Meet's own pop-out uses, since it moves real DOM nodes (video
// elements, live srcObject and all) into a floating always-on-top window
// while staying in this page's JS/WebRTC context, unlike a plain
// window.open() which would need its own separate connections entirely.
const SUPPORTS_PIP = typeof window !== 'undefined' && 'documentPictureInPicture' in window

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

  const [pinnedUid, setPinnedUid] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [pipWindow, setPipWindow] = useState(null)
  const containerRef = useRef(null)

  const isThisChannel = activeChannel?.groupId === groupId && activeChannel?.channelId === channel.id

  // If whoever's pinned leaves the channel, fall back to the grid rather
  // than spotlighting an empty tile.
  useEffect(() => {
    if (pinnedUid && !participants.some(p => p.uid === pinnedUid)) setPinnedUid(null)
  }, [pinnedUid, participants])

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Covers both closing it ourselves (togglePopOut) and the user closing the
  // floating window directly — either way the tile grid needs to come back
  // to the main window.
  useEffect(() => {
    if (!pipWindow) return
    const onPageHide = () => setPipWindow(null)
    pipWindow.addEventListener('pagehide', onPageHide)
    return () => pipWindow.removeEventListener('pagehide', onPageHide)
  }, [pipWindow])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else containerRef.current?.requestFullscreen().catch(() => {})
  }

  const togglePopOut = async () => {
    if (pipWindow) { pipWindow.close(); setPipWindow(null); return }
    if (!SUPPORTS_PIP) return
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 480, height: 320 })
      // Copy the page's stylesheets over — the pop-out starts as a blank
      // document, and the tile grid is styled entirely with Tailwind classes
      // that need this app's compiled CSS to mean anything.
      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          const css = Array.from(sheet.cssRules).map(r => r.cssText).join('')
          const style = win.document.createElement('style')
          style.textContent = css
          win.document.head.appendChild(style)
        } catch {
          if (sheet.href) {
            const link = win.document.createElement('link')
            link.rel = 'stylesheet'
            link.href = sheet.href
            win.document.head.appendChild(link)
          }
        }
      })
      win.document.body.style.margin = '0'
      win.document.body.style.background = '#000'
      setPipWindow(win)
    } catch (e) {
      console.warn('[VoiceChannelRoom] pop-out failed:', e.message)
    }
  }

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
    }
  })

  const pinned = pinnedUid ? tiles.find(t => t.uid === pinnedUid) : null
  const others = pinned ? tiles.filter(t => t.uid !== pinnedUid) : []

  // Near-square grid from participant count (ceil(sqrt(n)): 1->1, 2->2,
  // 3or4->2, 5or6->3, 9->3, ...), same heuristic most video-call apps use.
  // Rows and columns both get 1fr tracks filling the FULL content area —
  // this is what makes one person fill nearly the whole pane (matching
  // Discord) instead of being capped at some fixed max size, while still
  // shrinking every tile as more people join.
  const cols = Math.max(1, Math.ceil(Math.sqrt(tiles.length)))
  const rows = Math.max(1, Math.ceil(tiles.length / cols))

  // Clicking a tile spotlights it (big, everyone else drops to a thumbnail
  // strip) — clicking the spotlighted tile again returns to the grid.
  const tileGrid = pinned ? (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-1 min-h-0">
        <ParticipantTile {...pinned} onClick={() => setPinnedUid(null)} />
      </div>
      {others.length > 0 && (
        <div className="h-24 flex gap-2 overflow-x-auto shrink-0">
          {others.map(t => (
            <div key={t.uid} className="h-24 w-36 shrink-0">
              <ParticipantTile {...t} onClick={() => setPinnedUid(t.uid)} />
            </div>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div
      className="grid gap-3 h-full"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
    >
      {tiles.map(t => (
        <ParticipantTile key={t.uid} {...t} span={t.isScreen ? Math.min(2, cols) : 1} onClick={() => setPinnedUid(t.uid)} />
      ))}
    </div>
  )

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-bg-main min-w-0">
      <div className="h-12 px-4 flex items-center gap-2 border-b border-line-subtle shrink-0">
        <VoiceIcon className="text-ink-dim shrink-0" />
        <span className="font-semibold truncate">{channel.name}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 relative">
        {pipWindow ? (
          <>
            {createPortal(tileGrid, pipWindow.document.body)}
            <div className="h-full grid place-items-center text-ink-dim text-sm">
              Showing in a separate window
            </div>
          </>
        ) : tileGrid}

        <div className="absolute bottom-4 right-4 flex items-center gap-1.5">
          {SUPPORTS_PIP && (
            <RoomControlButton onClick={togglePopOut} label={pipWindow ? 'Close pop-out window' : 'Pop out'} active={!!pipWindow}>
              <PopOutIcon />
            </RoomControlButton>
          )}
          <RoomControlButton onClick={toggleFullscreen} label={isFullscreen ? 'Exit full screen' : 'Full screen'} active={isFullscreen}>
            {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
          </RoomControlButton>
        </div>
      </div>
    </div>
  )
}

function ParticipantTile({ name, photoURL, speaking, muted, hasVideo, isScreen, stream, span = 1, onClick }) {
  const videoRef = useRef(null)

  // Only the VIDEO track goes on this element, and it stays muted forever —
  // both parts matter:
  //  - A peer's `stream` here is their whole connection (audio + video, see
  //    ontrack in useVoiceChannel). Their audio is already playing through
  //    VoiceStatusBar's <audio> sinks, which is the single choke point where
  //    deafen / output volume / output device get applied — letting it play
  //    here too would double it AND escape all three (deafen wouldn't silence
  //    anyone whose camera was on).
  //  - An unmuted autoplaying element is subject to the browser's autoplay
  //    policy, which silently refuses to start without a recent user gesture
  //    and leaves the tile black. That's why remote tiles could come up blank
  //    while your own — muted, so always exempt — never did.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const track = hasVideo ? stream?.getVideoTracks?.()[0] : null
    if (!track) { el.srcObject = null; return }

    const attach = () => {
      el.srcObject = new MediaStream([track])
      // Belt-and-braces alongside the autoPlay attribute — a muted element is
      // always allowed to start, so a rejection here is genuinely exceptional.
      el.play().catch(() => {})
    }
    attach()

    // Every peer connection carries a video transceiver from the moment it's
    // built (see createPeerFor — that's what makes camera/screen-share a
    // renegotiation-free replaceTrack later), so ontrack hands us a video
    // track long before anyone actually shares anything. That track sits
    // `muted` — no RTP behind it — and only unmutes once real frames start
    // flowing. Chrome will happily leave the element blank forever if
    // srcObject was assigned during that muted window, so re-attach on unmute
    // instead of trusting the first assignment to catch up on its own.
    track.addEventListener('unmute', attach)
    return () => track.removeEventListener('unmute', attach)
  }, [stream, hasVideo])

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ gridColumn: `span ${span}` }}
      className={[
        'relative rounded-xl overflow-hidden bg-bg-raised flex items-center justify-center transition-shadow w-full h-full cursor-pointer',
        speaking ? 'ring-2 ring-ok' : '',
      ].join(' ')}
    >
      {/* The avatar placeholder always renders, with any video layered on top
          of it rather than swapped in for it. A <video> paints nothing until
          its first frame arrives, so this is what's behind it in the gap
          between "they flipped their camera on" (a roster flag, instant) and
          "their frames are actually arriving here" (a real network round
          trip) — the person's avatar, rather than an empty grey tile that
          reads as broken. */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ background: colorFromName(name) }}>
        <Avatar name={name} src={photoURL} size={64} />
      </div>
      {hasVideo && (
        <video ref={videoRef} autoPlay playsInline muted className="relative w-full h-full object-cover" />
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 rounded px-2 py-1 max-w-[calc(100%-1rem)]">
        {muted && <MicOffIcon className="text-bad shrink-0" />}
        {isScreen && <ScreenIcon className="text-white shrink-0" />}
        <span className="text-xs text-white truncate">{name}</span>
      </div>
    </button>
  )
}

function RoomControlButton({ onClick, active, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'p-2 rounded-md transition-colors',
        active ? 'bg-brand text-white' : 'bg-black/40 text-white/80 hover:text-white hover:bg-black/60',
      ].join(' ')}
    >
      {children}
    </button>
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

function PopOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
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
