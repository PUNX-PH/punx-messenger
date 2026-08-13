// Glues lib/voiceChannel.js (Firestore signaling) to lib/webrtc.js
// (RTCPeerConnection) behind one hook, shared app-wide via context — same
// "one engine, mounted once in App.jsx, everyone else just reads it" pattern
// as lib/useCall.jsx. The structural difference from useCall: this manages a
// *map* of peer connections (one per other participant, mesh topology)
// instead of a single one, and there's no ring/accept lifecycle — joining a
// voice channel and discovering who else is already there are the same
// "roster listener's first snapshot" event (see listenParticipants).
//
// See firestore.rules `voiceParticipants`/`voiceSignals` for the
// server-enforced rules this reacts to.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth'
import {
  attachVoiceAnswer, createVoiceOffer, deleteVoiceSignal, heartbeatRoster, joinRoster,
  leaveRoster, listenMyVoiceSignals, listenParticipants, listenVoiceCandidates,
  pruneStaleParticipants, sendVoiceIceCandidate, setRosterState, voiceOffererUid, voicePairKey,
} from './voiceChannel'
import { createPeerConnection, getLocalStream, stopStream } from './webrtc'

const HEARTBEAT_MS = 15_000

// ---- Speaking detection (Web Audio) ----
// Purely a UI affordance (the glowing ring in VoiceParticipants) — never
// gates any signaling decision, so a browser that can't do Web Audio for
// some reason just never lights up, nothing else degrades.
const SPEAKING_THRESHOLD = 12       // 0-255 avg frequency-bin level to count as "talking"
const SPEAKING_HANGOVER_MS = 400    // keep the glow briefly after level drops, avoids flicker
const SPEAKING_POLL_MS = 150

function useVoiceChannelEngine() {
  const { profile } = useAuth()
  const myUid = profile?.id

  const [activeChannel, setActiveChannel] = useState(null) // { groupId, channelId, channelName } | null
  const [participants, setParticipants] = useState([])
  const [remoteStreams, setRemoteStreams] = useState({}) // { [peerUid]: MediaStream }
  const [speakingUids, setSpeakingUids] = useState(() => new Set())
  const [muted, setMuted] = useState(false)
  const [connError, setConnError] = useState(null)
  const [joining, setJoining] = useState(false)

  // Mutable session state that must never go stale inside async callbacks —
  // kept in refs, mirrored to state only where the UI needs to re-render.
  const activeChannelRef = useRef(null)
  const localStreamRef = useRef(null)
  const peersRef = useRef(new Map()) // peerUid -> { pc, unsubCandidates, pendingCandidates, appliedCandidateIds }
  const unsubRosterRef = useRef(null)
  const unsubSignalsRef = useRef(null)
  const heartbeatIntervalRef = useRef(null)
  const audioCtxRef = useRef(null) // one shared AudioContext for every analyser (local + all peers)
  const analysersRef = useRef(new Map()) // uid -> { source, analyser, data, lastLoudAt }
  const speakingIntervalRef = useRef(null)
  const speakingSetRef = useRef(new Set())

  // Taps a stream (mine or a peer's) for its live volume level, keyed by
  // uid, so VoiceParticipants can put a glowing ring around whoever's
  // currently talking. One shared AudioContext for the whole session rather
  // than one per participant — cheaper, and closed just once on teardown.
  const attachAnalyser = useCallback((uid, stream) => {
    if (analysersRef.current.has(uid)) return
    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) return
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        audioCtxRef.current = new AudioCtx()
      }
      const ctx = audioCtxRef.current
      ctx.resume().catch(() => {})
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      analysersRef.current.set(uid, {
        source, analyser, data: new Uint8Array(analyser.frequencyBinCount), lastLoudAt: 0,
      })
    } catch (e) {
      console.warn('[useVoiceChannel] could not analyze audio level for', uid, e.message)
    }
  }, [])

  const detachAnalyser = useCallback((uid) => {
    const entry = analysersRef.current.get(uid)
    if (!entry) return
    entry.source.disconnect()
    analysersRef.current.delete(uid)
  }, [])

  // Closes one peer's connection and tears down its signaling doc. Used both
  // for an explicit full leave (looped over every peer) and reactively when
  // the roster listener reports that peer has gone — either side may notice
  // first, so the Firestore delete is idempotent by design.
  const closePeer = useCallback((peerUid) => {
    const entry = peersRef.current.get(peerUid)
    if (!entry) return
    entry.unsubCandidates?.()
    entry.pc.close()
    peersRef.current.delete(peerUid)
    detachAnalyser(peerUid)
    setRemoteStreams(prev => {
      if (!(peerUid in prev)) return prev
      const next = { ...prev }
      delete next[peerUid]
      return next
    })
    const ch = activeChannelRef.current
    if (ch && myUid) {
      deleteVoiceSignal(ch.groupId, ch.channelId, voicePairKey(myUid, peerUid)).catch(() => {})
    }
  }, [myUid, detachAnalyser])

  const teardown = useCallback(async () => {
    clearInterval(heartbeatIntervalRef.current)
    heartbeatIntervalRef.current = null
    unsubRosterRef.current?.(); unsubRosterRef.current = null
    unsubSignalsRef.current?.(); unsubSignalsRef.current = null

    const ch = activeChannelRef.current
    for (const peerUid of Array.from(peersRef.current.keys())) closePeer(peerUid)
    if (myUid) detachAnalyser(myUid)
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    stopStream(localStreamRef.current)
    localStreamRef.current = null

    if (ch && myUid) leaveRoster(ch.groupId, ch.channelId, myUid).catch(() => {})

    activeChannelRef.current = null
    setActiveChannel(null)
    setParticipants([])
    setRemoteStreams({})
    speakingSetRef.current = new Set()
    setSpeakingUids(new Set())
    setMuted(false)
  }, [myUid, closePeer, detachAnalyser])

  // Creates a peer connection for one participant, wired for both directions
  // of the offer/answer flow (this function is used whether I'm about to
  // send an offer or about to answer one). Always adds an empty video
  // transceiver up front — even though Phase A never puts a track on it —
  // so a later camera/screen-share toggle is a renegotiation-free
  // replaceTrack() call instead of a fresh SDP round per peer.
  const createPeerFor = useCallback((peerUid) => {
    const ch = activeChannelRef.current
    const pc = createPeerConnection()
    pc.addTransceiver('video', { direction: 'sendrecv' })
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current))

    const remote = new MediaStream()
    pc.ontrack = (e) => {
      remote.addTrack(e.track)
      attachAnalyser(peerUid, remote)
      setRemoteStreams(prev => ({ ...prev, [peerUid]: new MediaStream(remote.getTracks()) }))
    }
    pc.onicecandidate = (e) => {
      if (!e.candidate || !ch || !myUid) return
      const pairKey = voicePairKey(myUid, peerUid)
      sendVoiceIceCandidate(ch.groupId, ch.channelId, pairKey, myUid, e.candidate.toJSON()).catch(() => {})
    }
    pc.oniceconnectionstatechange = () => {
      // No reconnect/ICE-restart flow in v1 (same as the 1:1 call system) —
      // a failed pair just drops, rather than leaving a dead silent tile.
      if (pc.iceConnectionState === 'failed') closePeer(peerUid)
    }

    const entry = { pc, unsubCandidates: null, pendingCandidates: [], appliedCandidateIds: new Set() }
    peersRef.current.set(peerUid, entry)

    if (ch && myUid) {
      const pairKey = voicePairKey(myUid, peerUid)
      entry.unsubCandidates = listenVoiceCandidates(ch.groupId, ch.channelId, pairKey, (candDoc) => {
        if (candDoc.from === myUid) return
        if (entry.appliedCandidateIds.has(candDoc.id)) return
        entry.appliedCandidateIds.add(candDoc.id)
        if (pc.remoteDescription) {
          pc.addIceCandidate(new RTCIceCandidate(candDoc.candidate)).catch(() => {})
        } else {
          entry.pendingCandidates.push(candDoc.candidate)
        }
      }, (err) => setConnError(`Voice connection signaling failed: ${err?.message || err}`))
    }

    return { pc, entry }
  }, [myUid, closePeer, attachAnalyser])

  const flushPending = (pc, entry) => {
    const pending = entry.pendingCandidates
    entry.pendingCandidates = []
    pending.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}))
  }

  // I'm the deterministic offerer for this pair (see voiceOffererUid) —
  // create the connection and send the first offer. The other side never
  // calls this for the same pair; it just waits for the doc this writes.
  const offerTo = useCallback(async (peerUid) => {
    const ch = activeChannelRef.current
    if (!ch || !myUid || peersRef.current.has(peerUid)) return
    try {
      const { pc } = createPeerFor(peerUid)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await createVoiceOffer(ch.groupId, ch.channelId, myUid, peerUid, { sdp: offer.sdp, type: offer.type })
    } catch (e) {
      setConnError(`Couldn't connect to a participant: ${e.message}`)
    }
  }, [myUid, createPeerFor])

  // Handles every change across all my signaling pairs in this channel: an
  // incoming offer to answer (once), or the answer to an offer I sent.
  const handleSignalDocs = useCallback(async (docs) => {
    const ch = activeChannelRef.current
    if (!ch || !myUid) return
    for (const sig of docs) {
      const peerUid = sig.uids.find(u => u !== myUid)
      if (!peerUid) continue

      if (sig.offererUid !== myUid) {
        // Peer is the offerer for this pair — answer once, the first time
        // their offer shows up. peersRef already having an entry means
        // I've already answered (or am mid-flight answering) this pair.
        if (peersRef.current.has(peerUid) || !sig.offer) continue
        try {
          const { pc, entry } = createPeerFor(peerUid)
          await pc.setRemoteDescription(new RTCSessionDescription(sig.offer))
          flushPending(pc, entry)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          await attachVoiceAnswer(ch.groupId, ch.channelId, sig.id, { sdp: answer.sdp, type: answer.type })
        } catch (e) {
          setConnError(`Couldn't answer a participant: ${e.message}`)
        }
      } else {
        // I'm the offerer — apply the answer once it arrives.
        const entry = peersRef.current.get(peerUid)
        if (!entry || !sig.answer || entry.pc.currentRemoteDescription) continue
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(sig.answer))
          flushPending(entry.pc, entry)
        } catch (e) {
          setConnError(`Connection to a participant failed: ${e.message}`)
        }
      }
    }
  }, [myUid, createPeerFor])

  // Roster listener's added/removed lists drive peer-connection lifecycle
  // directly — this fires identically whether "added" means a genuinely new
  // joiner, or (on the very first snapshot right after I join) an
  // already-present participant I'm just now discovering.
  const handleRosterChange = useCallback((all, { added, removed }) => {
    setParticipants(all)
    if (!myUid) return
    added.forEach(uid => {
      if (uid === myUid || peersRef.current.has(uid)) return
      if (voiceOffererUid(myUid, uid) === myUid) offerTo(uid)
      // else: wait for their offer to arrive via handleSignalDocs.
    })
    removed.forEach(uid => {
      if (uid === myUid) return
      closePeer(uid)
    })
  }, [myUid, offerTo, closePeer])

  const join = useCallback(async (groupId, channelId, channelName) => {
    if (!myUid || joining) return
    const current = activeChannelRef.current
    if (current?.groupId === groupId && current?.channelId === channelId) return // already here
    if (current) await teardown() // v1: one voice channel at a time
    setConnError(null)
    setJoining(true)
    try {
      const stream = await getLocalStream({ audio: true, video: false })
      localStreamRef.current = stream
      attachAnalyser(myUid, stream)

      const ch = { groupId, channelId, channelName }
      activeChannelRef.current = ch
      setActiveChannel(ch)

      await joinRoster(groupId, channelId, myUid)

      heartbeatIntervalRef.current = setInterval(() => {
        heartbeatRoster(groupId, channelId, myUid)
        pruneStaleParticipants(groupId, channelId)
      }, HEARTBEAT_MS)

      unsubSignalsRef.current = listenMyVoiceSignals(groupId, channelId, myUid, handleSignalDocs, (err) =>
        setConnError(`Voice signaling failed: ${err?.message || err}`))

      // Attached last, deliberately — its first snapshot both discovers
      // existing peers and starts ongoing add/remove reactivity in one path.
      unsubRosterRef.current = listenParticipants(groupId, channelId, handleRosterChange, (err) =>
        setConnError(`Couldn't load who's in this voice channel: ${err?.message || err}`))
    } catch (e) {
      setConnError(e.message || 'Could not join the voice channel.')
      await teardown()
    } finally {
      setJoining(false)
    }
  }, [myUid, joining, teardown, handleSignalDocs, handleRosterChange, attachAnalyser])

  const leave = useCallback(() => teardown(), [teardown])

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
    const ch = activeChannelRef.current
    if (ch && myUid) setRosterState(ch.groupId, ch.channelId, myUid, { muted: !track.enabled })
  }, [myUid])

  // Best-effort leave on tab close (may not always fire); staleness pruning
  // (see lib/voiceChannel.js) is the real safety net for crashes.
  useEffect(() => {
    const onPageHide = () => {
      const ch = activeChannelRef.current
      if (ch && myUid) leaveRoster(ch.groupId, ch.channelId, myUid).catch(() => {})
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [myUid])

  // Browsers throttle setInterval while a tab is backgrounded, which can
  // silently stall the heartbeat above for well past its normal 15s cadence
  // (see STALE_MS's comment in lib/voiceChannel.js). Firing one immediately
  // on regaining visibility — same pattern as lib/presence.jsx — shrinks
  // the window where a still-connected participant could get pruned right
  // as they switch back to this tab.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const ch = activeChannelRef.current
      if (ch && myUid) heartbeatRoster(ch.groupId, ch.channelId, myUid)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [myUid])

  // Polls every analyser's live volume level and republishes the set of
  // uids currently "talking" — a UI affordance only (VoiceParticipants'
  // glow ring), decoupled from signaling entirely. A short hangover after
  // level drops avoids the ring flickering between words.
  useEffect(() => {
    if (!activeChannel) return
    const tick = () => {
      const now = Date.now()
      const next = new Set()
      analysersRef.current.forEach((entry, uid) => {
        entry.analyser.getByteFrequencyData(entry.data)
        let sum = 0
        for (let i = 0; i < entry.data.length; i++) sum += entry.data[i]
        const avg = sum / entry.data.length
        if (avg > SPEAKING_THRESHOLD) entry.lastLoudAt = now
        if (now - entry.lastLoudAt < SPEAKING_HANGOVER_MS) next.add(uid)
      })
      const prev = speakingSetRef.current
      const changed = next.size !== prev.size || [...next].some(u => !prev.has(u))
      if (changed) {
        speakingSetRef.current = next
        setSpeakingUids(next)
      }
    }
    speakingIntervalRef.current = setInterval(tick, SPEAKING_POLL_MS)
    return () => clearInterval(speakingIntervalRef.current)
  }, [activeChannel])

  // Tear down on sign-out / app close.
  useEffect(() => () => { teardown() }, [teardown])

  return {
    activeChannel, participants, remoteStreams, speakingUids, muted, connError, joining, myUid,
    join, leave, toggleMute, clearConnError: () => setConnError(null),
  }
}

// ---------- Shared voice-channel context ----------
const VoiceChannelCtx = createContext(null)

export function VoiceChannelProvider({ children }) {
  const value = useVoiceChannelEngine()
  return <VoiceChannelCtx.Provider value={value}>{children}</VoiceChannelCtx.Provider>
}

export const useVoiceChannel = () => useContext(VoiceChannelCtx)
