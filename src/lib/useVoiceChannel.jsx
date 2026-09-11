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

const clamp01 = (v) => Math.min(1, Math.max(0, v))

const HEARTBEAT_MS = 15_000

// ---- Speaking detection (Web Audio) ----
// Purely a UI affordance (the glowing ring in VoiceParticipants) — never
// gates any signaling decision, so a browser that can't do Web Audio for
// some reason just never lights up, nothing else degrades.
const SPEAKING_THRESHOLD = 12       // 0-255 avg frequency-bin level to count as "talking"
const SPEAKING_HANGOVER_MS = 400    // keep the glow briefly after level drops, avoids flicker
const SPEAKING_POLL_MS = 150

// ---- Device/volume preferences (personal, not synced to Firestore) ----
// Persisted so a device/volume choice survives a rejoin or reload, same
// spirit as ChannelSidebar's collapsedCategories localStorage.
const PREFS_KEY = 'punx.voicePrefs'

// Mic processing defaults to fully on, matching both the browser's own
// default for a bare `audio: true` capture and Discord's out-of-the-box
// settings — someone who never opens the popover should get the filtered
// mic, not the raw one.
const PROCESSING_DEFAULTS = { noiseSuppression: true, echoCancellation: true, autoGainControl: true }

// The subset of prefs that are getUserMedia audio constraints, in the exact
// shape getLocalStream/applyConstraints want.
const audioProcessingFrom = (prefs) => ({
  noiseSuppression: prefs.noiseSuppression,
  echoCancellation: prefs.echoCancellation,
  autoGainControl: prefs.autoGainControl,
})

function loadVoicePrefs() {
  const bool = (v, fallback) => typeof v === 'boolean' ? v : fallback
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    return {
      inputDeviceId: raw.inputDeviceId ?? null,
      outputDeviceId: raw.outputDeviceId ?? null,
      inputVolume: typeof raw.inputVolume === 'number' ? raw.inputVolume : 1,
      outputVolume: typeof raw.outputVolume === 'number' ? raw.outputVolume : 1,
      noiseSuppression: bool(raw.noiseSuppression, PROCESSING_DEFAULTS.noiseSuppression),
      echoCancellation: bool(raw.echoCancellation, PROCESSING_DEFAULTS.echoCancellation),
      autoGainControl: bool(raw.autoGainControl, PROCESSING_DEFAULTS.autoGainControl),
    }
  } catch {
    return {
      inputDeviceId: null, outputDeviceId: null, inputVolume: 1, outputVolume: 1,
      ...PROCESSING_DEFAULTS,
    }
  }
}
function saveVoicePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* non-fatal */ }
}

function useVoiceChannelEngine() {
  const { profile } = useAuth()
  const myUid = profile?.id

  const [activeChannel, setActiveChannel] = useState(null) // { groupId, channelId, channelName } | null
  const [participants, setParticipants] = useState([])
  const [remoteStreams, setRemoteStreams] = useState({}) // { [peerUid]: MediaStream }
  const [speakingUids, setSpeakingUids] = useState(() => new Set())
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [localVideoStream, setLocalVideoStream] = useState(null) // whichever of camera/screen is active, or null
  const [connError, setConnError] = useState(null)
  const [joining, setJoining] = useState(false)
  const [voicePrefs, setVoicePrefs] = useState(loadVoicePrefs) // {inputDeviceId, outputDeviceId, inputVolume, outputVolume}
  const voicePrefsRef = useRef(voicePrefs) // read inside callbacks without needing voicePrefs in their deps

  // Mutable session state that must never go stale inside async callbacks —
  // kept in refs, mirrored to state only where the UI needs to re-render.
  const activeChannelRef = useRef(null)
  const localStreamRef = useRef(null) // raw mic capture — mute toggles this track, speaking analysis reads it
  const gainNodeRef = useRef(null) // input-volume control, sits between the raw mic and what peers actually receive
  const micSourceRef = useRef(null) // Web Audio node wrapping localStreamRef's track — swapped out on device change
  const processedStreamRef = useRef(null) // gain node's output — THIS is what gets added to every peer connection
  const cameraStreamRef = useRef(null) // raw getUserMedia video stream, only while cameraOn
  const screenStreamRef = useRef(null) // raw getDisplayMedia stream, only while screenSharing — mutually exclusive with camera
  const peersRef = useRef(new Map()) // peerUid -> { pc, videoSender, unsubCandidates, pendingCandidates, appliedCandidateIds }
  const unsubRosterRef = useRef(null)
  const unsubSignalsRef = useRef(null)
  const heartbeatIntervalRef = useRef(null)
  const audioCtxRef = useRef(null) // one shared AudioContext for every analyser (local + all peers) + the gain graph
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

  // Builds (or rebuilds, on an input-device swap) the graph that actually
  // gets sent to peers: raw mic -> GainNode (the input-volume slider) ->
  // MediaStreamDestination. Peer connections receive the DESTINATION's
  // track, whose identity never changes across a device swap — only what
  // feeds it does — so switching microphones needs zero replaceTrack() /
  // renegotiation on any existing peer connection.
  const buildGainGraph = useCallback((rawStream) => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      audioCtxRef.current = new AudioCtx()
    }
    const ctx = audioCtxRef.current
    ctx.resume().catch(() => {})
    const source = ctx.createMediaStreamSource(rawStream)
    const gain = ctx.createGain()
    gain.gain.value = voicePrefsRef.current.inputVolume
    source.connect(gain)
    const dest = ctx.createMediaStreamDestination()
    gain.connect(dest)
    micSourceRef.current = source
    gainNodeRef.current = gain
    processedStreamRef.current = dest.stream
  }, [])

  const teardownGainGraph = useCallback(() => {
    micSourceRef.current?.disconnect()
    gainNodeRef.current?.disconnect()
    micSourceRef.current = null
    gainNodeRef.current = null
    processedStreamRef.current = null
  }, [])

  // Closes one peer's connection and tears down its signaling doc. Used both
  // for an explicit full leave (looped over every peer) and reactively when
  // the roster listener reports that peer has gone — either side may notice
  // first, so the Firestore delete is idempotent by design.
  // keepSignal: tear down only the local peer connection, leaving the pair's
  // signaling doc alone. Used by the re-answer recovery in handleSignalDocs —
  // there the doc holds the offerer's CURRENT offer, the very thing we are
  // about to answer, so deleting it destroys the negotiation we are trying to
  // rescue and leaves the pair half-connected (the offerer hears us, we hear
  // nothing). Every other caller means "this pair is over", and should delete.
  const closePeer = useCallback((peerUid, { keepSignal = false } = {}) => {
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
    if (!keepSignal && ch && myUid) {
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
    teardownGainGraph()
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    stopStream(localStreamRef.current)
    localStreamRef.current = null
    stopStream(cameraStreamRef.current)
    cameraStreamRef.current = null
    stopStream(screenStreamRef.current)
    screenStreamRef.current = null

    if (ch && myUid) leaveRoster(ch.groupId, ch.channelId, myUid).catch(() => {})

    activeChannelRef.current = null
    setActiveChannel(null)
    setParticipants([])
    setRemoteStreams({})
    speakingSetRef.current = new Set()
    setSpeakingUids(new Set())
    setMuted(false)
    setDeafened(false)
    setCameraOn(false)
    setScreenSharing(false)
    setLocalVideoStream(null)
  }, [myUid, closePeer, detachAnalyser, teardownGainGraph])

  // The video track I'm currently sending, if any — camera and screen-share
  // are mutually exclusive and share the one video transceiver per peer.
  // Reads only refs, so an empty dep list is genuinely stable rather than a
  // stale closure waiting to happen.
  const activeVideoTrack = useCallback(
    () => cameraStreamRef.current?.getVideoTracks()[0] || screenStreamRef.current?.getVideoTracks()[0] || null,
    [],
  )

  /**
   * Adopt the video transceiver that setRemoteDescription(offer) created, and
   * open it for sending. ANSWERER ONLY, and it must run after
   * setRemoteDescription but before createAnswer.
   *
   * Why this exists at all — this was a real bug, don't undo it:
   * `addTransceiver('video')` on the answerer BEFORE applying the offer does
   * NOT get associated with the offer's video m-line. Chrome leaves that
   * transceiver orphaned (mid null, currentDirection null) and creates a
   * second, `recvonly` one to carry the offer's m-line. Two things then break,
   * in opposite directions:
   *   - the answerer's stored videoSender points at the orphan, so every
   *     replaceTrack() on it goes nowhere and NOBODY ever sees that person's
   *     camera or screen share;
   *   - the answer advertises `a=recvonly` for video, which drops the OFFERER
   *     to `sendonly` — so the offerer can never receive anyone's video either.
   * Self-view keeps working throughout, because that renders localVideoStream
   * directly and never touches a peer connection. That is the whole "mine
   * works, theirs doesn't" shape.
   * Verified against two live RTCPeerConnections: with this, both ends
   * negotiate `video:sendrecv`, ontrack delivers a video track to both, and a
   * post-negotiation replaceTrack() reaches the far side.
   */
  const adoptVideoTransceiver = useCallback((pc, entry) => {
    const tx = pc.getTransceivers().find(t => t.receiver?.track?.kind === 'video')
    if (!tx) {
      // No video m-line in the offer at all — leave videoSender null rather
      // than inventing a transceiver here, which would need renegotiation.
      // Every send site is `videoSender?.`-guarded, so this degrades to
      // audio-only with that one peer instead of throwing.
      console.warn('[useVoiceChannel] offer carried no video m-line; video disabled for this peer')
      return
    }
    // Without this the answer says recvonly and BOTH directions of video die.
    tx.direction = 'sendrecv'
    // Give the adopted transceiver the same stream association the offerer sets
    // at creation, so our ANSWER also carries an msid for video. Without it a
    // receiver of our video gets a track with an empty `streams` — harmless on
    // web, which accumulates tracks by hand, but the Android renderer resolves
    // natively from a MediaStream and has nothing to work with. See the note in
    // android_app/lib/providers/voice_channel_providers.dart.
    const localForMsid = processedStreamRef.current
    if (localForMsid && tx.sender.setStreams) {
      // Chrome-only, and this app is already Chromium-targeted elsewhere.
      try { tx.sender.setStreams(localForMsid) } catch { /* not supported */ }
    }
    entry.videoSender = tx.sender
    // Also covers a toggle that landed during the await above, which would
    // have skipped this peer while its videoSender was still null.
    const track = activeVideoTrack()
    if (track) tx.sender.replaceTrack(track).catch(() => {})
  }, [activeVideoTrack])

  // Creates a peer connection for one participant. `isOfferer` decides who
  // sets up the video transceiver: the offerer adds it up front (empty, so a
  // later camera/screen-share toggle is a renegotiation-free replaceTrack()
  // rather than a fresh SDP round), while the answerer must NOT — it adopts
  // the one the offer creates, via adoptVideoTransceiver above. Adding it on
  // both sides is what caused remote video to fail in one direction.
  const createPeerFor = useCallback((peerUid, { isOfferer }) => {
    const ch = activeChannelRef.current
    const pc = createPeerConnection()
    let videoSender = null
    if (isOfferer) {
      // Pass the stream, not only a direction. Without it nothing signals an
      // msid for this m-line and every receiver gets a video track with an
      // empty `streams`, which is what broke Android — see adoptVideoTransceiver
      // above and the note in
      // android_app/lib/providers/voice_channel_providers.dart. Reusing the
      // audio stream is deliberate: one remote MediaStream per peer carrying
      // both tracks is exactly what ontrack already builds by hand here.
      const localForMsid = processedStreamRef.current
      const videoTransceiver = pc.addTransceiver('video', {
        direction: 'sendrecv',
        ...(localForMsid ? { streams: [localForMsid] } : {}),
      })
      videoSender = videoTransceiver.sender
      // If my camera/screen-share was already on before this peer joined,
      // give their sender a track immediately — same replaceTrack() path
      // toggleCamera/toggleScreenShare use, just applied at connection setup
      // instead of after the fact.
      const track = activeVideoTrack()
      if (track) videoSender.replaceTrack(track).catch(() => {})
    }
    // Send the gain-processed stream (raw mic -> input-volume GainNode),
    // not the raw mic stream directly — see buildGainGraph.
    processedStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, processedStreamRef.current))

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

    const entry = {
      // null for the answerer until adoptVideoTransceiver() fills it in.
      pc, videoSender,
      unsubCandidates: null, pendingCandidates: [], appliedCandidateIds: new Set(),
      // Both are set SYNCHRONOUSLY, before the awaits they guard. handleSignalDocs
      // is async and re-entrant — the signal listener redelivers every doc on any
      // change, including each trickling ICE candidate — so a guard that reads
      // state only set after an await (pc.currentRemoteDescription, say) lets two
      // concurrent runs through and applies the same SDP twice.
      //
      // answerer side: which offer this connection answered, so a REPLACED
      // offer reads as new work rather than being skipped.
      answeredOfferSdp: null,
      // offerer side: the offer this connection published, and whether the
      // answer belonging to it has been consumed.
      offeredSdp: null,
      answerApplied: false,
    }
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
  }, [myUid, closePeer, attachAnalyser, activeVideoTrack])

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
      const { pc, entry } = createPeerFor(peerUid, { isOfferer: true })
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      // Remember WHICH offer is outstanding. A leftover doc can already carry
      // an answer aimed at some previous, now-closed connection, and applying
      // that gives a DTLS fingerprint for a peer that no longer exists: ICE
      // reaches `connected` and DTLS then sits in `connecting` forever, with
      // no error anywhere. The answer we want is the one sitting alongside
      // THIS offer, so the guard below compares against it.
      entry.offeredSdp = offer.sdp
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
        // Peer is the offerer for this pair — answer their offer once. Keyed on
        // the OFFER, not merely on the peer: createVoiceOffer deletes and
        // re-offers when it finds a leftover doc from a crashed session, and
        // that is the common case, since teardown only runs on a clean leave.
        // A guard of `peersRef.has(peerUid)` alone skipped the replacement
        // offer forever, so whichever pair lost that race stayed silent for the
        // rest of the session while every other pair worked — "some people
        // can't hear them, others can".
        if (!sig.offer) continue
        const existing = peersRef.current.get(peerUid)
        if (existing) {
          // Same offer: already answered it, or still mid-flight answering.
          if (existing.answeredOfferSdp === sig.offer.sdp) continue
          // Different offer: the doc was replaced underneath us. The old peer
          // connection is negotiating against an offer that no longer exists.
          closePeer(peerUid, { keepSignal: true })
        }
        try {
          const { pc, entry } = createPeerFor(peerUid, { isOfferer: false })
          // Synchronously, before the first await — this is what makes the
          // guard above mean "mid-flight" and not just "finished".
          entry.answeredOfferSdp = sig.offer.sdp
          await pc.setRemoteDescription(new RTCSessionDescription(sig.offer))
          // Must sit between setRemoteDescription and createAnswer: it's what
          // makes the answer advertise sendrecv for video instead of recvonly.
          adoptVideoTransceiver(pc, entry)
          flushPending(pc, entry)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          const stored = await attachVoiceAnswer(
            ch.groupId, ch.channelId, sig.id, { sdp: answer.sdp, type: answer.type },
          )
          if (!stored) {
            // Refused: this offer was superseded while we answered it. Drop the
            // peer so the replacement offer — which the listener delivers as a
            // change to this same doc — is answered from scratch above. Not an
            // error the user should see; the recovery is automatic.
            closePeer(peerUid, { keepSignal: true })
          }
        } catch (e) {
          setConnError(`Couldn't answer a participant: ${e.message}`)
        }
      } else {
        // I'm the offerer — apply the answer once it arrives.
        const entry = peersRef.current.get(peerUid)
        // `entry.answerApplied` rather than `pc.currentRemoteDescription`: the
        // latter is only populated once setRemoteDescription RESOLVES, leaving
        // the whole duration of that call as a window in which a redelivered
        // snapshot passes the guard too. Both runs then applied the same answer,
        // and the second landed on an already-stable connection — "Failed to set
        // remote answer sdp: Called in wrong state: stable".
        if (!entry || !sig.answer || entry.answerApplied) continue
        // Only the answer paired with the offer I actually wrote. Until my own
        // createVoiceOffer lands, this doc still holds the previous session's
        // offer/answer pair; that answer is not mine to apply.
        if (!entry.offeredSdp || sig.offer?.sdp !== entry.offeredSdp) continue
        entry.answerApplied = true
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(sig.answer))
          flushPending(entry.pc, entry)
        } catch (e) {
          setConnError(`Connection to a participant failed: ${e.message}`)
        }
      }
    }
  }, [myUid, createPeerFor, adoptVideoTransceiver, closePeer])

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
      const preferredInput = voicePrefsRef.current.inputDeviceId
      const audioProcessing = audioProcessingFrom(voicePrefsRef.current)
      let stream
      try {
        stream = await getLocalStream({
          audio: true, video: false, audioDeviceId: preferredInput || undefined, audioProcessing,
        })
      } catch {
        // Saved device may no longer exist (unplugged, etc.) — fall back to
        // the default device, but keep the processing preferences.
        stream = await getLocalStream({ audio: true, video: false, audioProcessing })
      }
      localStreamRef.current = stream
      attachAnalyser(myUid, stream)
      buildGainGraph(stream)

      const ch = { groupId, channelId, channelName }
      activeChannelRef.current = ch
      setActiveChannel(ch)

      await joinRoster(groupId, channelId, myUid)

      heartbeatIntervalRef.current = setInterval(() => {
        heartbeatRoster(groupId, channelId, myUid)
        pruneStaleParticipants(groupId, channelId, myUid)
      }, HEARTBEAT_MS)

      unsubSignalsRef.current = listenMyVoiceSignals(groupId, channelId, myUid, handleSignalDocs, (err) =>
        setConnError(`Voice signaling failed: ${err?.message || err}`))

      // Attached last, deliberately — its first snapshot both discovers
      // existing peers and starts ongoing add/remove reactivity in one path.
      unsubRosterRef.current = listenParticipants(groupId, channelId, handleRosterChange, (err) =>
        setConnError(`Couldn't load who's in this voice channel: ${err?.message || err}`))
    } catch (e) {
      // Logged as well as surfaced: this path tears the session down, and a
      // permission-denied from joinRoster is otherwise completely silent —
      // the Firestore SDK doesn't log a rejected write the way it logs a
      // failed listener, and the caught error has nowhere else to go.
      console.error('[useVoiceChannel] join failed:', e)
      setConnError(e.message || 'Could not join the voice channel.')
      await teardown()
    } finally {
      setJoining(false)
    }
  }, [myUid, joining, teardown, handleSignalDocs, handleRosterChange, attachAnalyser, buildGainGraph])

  const leave = useCallback(() => teardown(), [teardown])

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    const nextEnabled = !track.enabled
    track.enabled = nextEnabled
    setMuted(!nextEnabled)
    // Unmuting while deafened also un-deafens (matches Discord) — being
    // heard while unable to hear anyone isn't a state that makes sense.
    const clearingDeafen = nextEnabled && deafened
    if (clearingDeafen) setDeafened(false)
    const ch = activeChannelRef.current
    if (ch && myUid) {
      setRosterState(ch.groupId, ch.channelId, myUid,
        clearingDeafen ? { muted: false, deafened: false } : { muted: !nextEnabled })
    }
  }, [myUid, deafened])

  // Deafening always mutes the mic too — can't be heard while you can't
  // hear anyone. Un-deafening deliberately does NOT auto-unmute (matches
  // Discord — you come back muted and have to explicitly unmute).
  const toggleDeafen = useCallback(() => {
    const next = !deafened
    setDeafened(next)
    if (next) {
      const track = localStreamRef.current?.getAudioTracks()[0]
      if (track) { track.enabled = false; setMuted(true) }
    }
    const ch = activeChannelRef.current
    if (ch && myUid) {
      setRosterState(ch.groupId, ch.channelId, myUid, next ? { deafened: true, muted: true } : { deafened: false })
    }
  }, [deafened, myUid])

  // Unconditional "turn it off" helpers, deliberately not folded into the
  // toggle functions below — the browser's own "Stop sharing" control ends
  // the screen-share track directly (see toggleScreenShare's track.onended),
  // and that has to land on correct behavior regardless of whatever
  // `screenSharing` happened to be captured in that closure at the time.
  const stopCameraTracks = useCallback(() => {
    stopStream(cameraStreamRef.current)
    cameraStreamRef.current = null
    setCameraOn(false)
    setLocalVideoStream(null)
    peersRef.current.forEach(entry => entry.videoSender?.replaceTrack(null).catch(() => {}))
    const ch = activeChannelRef.current
    if (ch && myUid) setRosterState(ch.groupId, ch.channelId, myUid, { cameraOn: false })
  }, [myUid])

  const stopScreenShareTracks = useCallback(() => {
    stopStream(screenStreamRef.current)
    screenStreamRef.current = null
    setScreenSharing(false)
    setLocalVideoStream(null)
    peersRef.current.forEach(entry => entry.videoSender?.replaceTrack(null).catch(() => {}))
    const ch = activeChannelRef.current
    if (ch && myUid) setRosterState(ch.groupId, ch.channelId, myUid, { screenSharing: false })
  }, [myUid])

  // Camera and screen-share are mutually exclusive in v1 and share the one
  // video transceiver every peer connection already has (see createPeerFor)
  // — turning either on/off is just a replaceTrack() per peer, never a
  // renegotiation, which is the entire reason that transceiver was added
  // empty back at join time.
  const toggleCamera = useCallback(async () => {
    if (cameraOn) { stopCameraTracks(); return }
    try {
      if (screenSharing) stopScreenShareTracks()
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
      cameraStreamRef.current = camStream
      const track = camStream.getVideoTracks()[0]
      peersRef.current.forEach(entry => entry.videoSender?.replaceTrack(track).catch(() => {}))
      setCameraOn(true)
      setLocalVideoStream(camStream)
      const ch = activeChannelRef.current
      if (ch && myUid) setRosterState(ch.groupId, ch.channelId, myUid, { cameraOn: true })
    } catch (e) {
      setConnError(`Couldn't turn on your camera: ${e.message}`)
    }
  }, [cameraOn, screenSharing, stopCameraTracks, stopScreenShareTracks, myUid])

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) { stopScreenShareTracks(); return }
    try {
      if (cameraOn) stopCameraTracks()
      // Video only — capturing system audio too would need a second audio
      // transceiver (out of scope for v1; see the voice-channels plan).
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStreamRef.current = screenStream
      const track = screenStream.getVideoTracks()[0]
      // Tell the encoder this is screen content, not a face.
      //
      // Without a hint the encoder treats a share like camera video and
      // optimises for smooth motion, which for a static page means it is slow
      // to emit the first keyframe — and a receiver cannot paint ANYTHING
      // until that keyframe lands. That is the several seconds of black a
      // viewer sees when a share starts on a page that isn't moving.
      //
      // 'detail' asks for sharp text at the cost of framerate, which is the
      // right trade for a console or a document, and makes the encoder far
      // readier to produce a frame for still content. It does not eliminate
      // the wait — no browser API lets a receiver request a keyframe — but it
      // is the one lever the sender has.
      track.contentHint = 'detail'
      peersRef.current.forEach(entry => entry.videoSender?.replaceTrack(track).catch(() => {}))
      // The browser's own "Stop sharing" bar/button ends the track directly
      // — catch that so our state doesn't get stuck showing "sharing".
      track.onended = () => stopScreenShareTracks()
      setScreenSharing(true)
      setLocalVideoStream(screenStream)
      const ch = activeChannelRef.current
      if (ch && myUid) setRosterState(ch.groupId, ch.channelId, myUid, { screenSharing: true })
    } catch (e) {
      // Cancelling the "choose what to share" picker rejects with
      // NotAllowedError — not a real error worth surfacing.
      if (e.name !== 'NotAllowedError') setConnError(`Couldn't start screen share: ${e.message}`)
    }
  }, [screenSharing, cameraOn, stopScreenShareTracks, stopCameraTracks, myUid])

  const setInputVolume = useCallback((value) => {
    const v = clamp01(value)
    const next = { ...voicePrefsRef.current, inputVolume: v }
    voicePrefsRef.current = next
    setVoicePrefs(next)
    saveVoicePrefs(next)
    if (gainNodeRef.current) gainNodeRef.current.gain.value = v
  }, [])

  const setOutputVolume = useCallback((value) => {
    const v = clamp01(value)
    const next = { ...voicePrefsRef.current, outputVolume: v }
    voicePrefsRef.current = next
    setVoicePrefs(next)
    saveVoicePrefs(next)
  }, [])

  // Applied by VoiceStatusBar via HTMLMediaElement.setSinkId() on each
  // remote <audio> sink — nothing to do at the WebRTC layer for this one.
  const setOutputDevice = useCallback((deviceId) => {
    const next = { ...voicePrefsRef.current, outputDeviceId: deviceId }
    voicePrefsRef.current = next
    setVoicePrefs(next)
    saveVoicePrefs(next)
  }, [])

  // Re-opens the mic with different constraints and splices the new capture
  // into the existing gain graph. Nothing at the WebRTC layer moves: peers
  // hold the gain node's DESTINATION track (see buildGainGraph), whose
  // identity doesn't depend on whatever is feeding it — so no replaceTrack,
  // no renegotiation, no audible gap for anyone else in the channel.
  const swapMicStream = useCallback(async ({ deviceId, audioProcessing }) => {
    const wasEnabled = localStreamRef.current?.getAudioTracks()[0]?.enabled ?? true
    const newRaw = await getLocalStream({
      audio: true, video: false, audioDeviceId: deviceId || undefined, audioProcessing,
    })
    const newTrack = newRaw.getAudioTracks()[0]
    if (newTrack) newTrack.enabled = wasEnabled // carry the current mute state over

    const oldRaw = localStreamRef.current
    detachAnalyser(myUid)
    micSourceRef.current?.disconnect()

    const source = audioCtxRef.current.createMediaStreamSource(newRaw)
    source.connect(gainNodeRef.current)
    micSourceRef.current = source

    localStreamRef.current = newRaw
    attachAnalyser(myUid, newRaw)
    stopStream(oldRaw)
  }, [myUid, detachAnalyser, attachAnalyser])

  // Swapping the input device does NOT touch any peer connection — see
  // swapMicStream/buildGainGraph.
  const setInputDevice = useCallback(async (deviceId) => {
    const next = { ...voicePrefsRef.current, inputDeviceId: deviceId }
    voicePrefsRef.current = next
    setVoicePrefs(next)
    saveVoicePrefs(next)
    if (!activeChannelRef.current || !myUid) return // just remembered for the next join
    try {
      await swapMicStream({ deviceId, audioProcessing: audioProcessingFrom(next) })
    } catch (e) {
      setConnError(`Couldn't switch microphones: ${e.message}`)
    }
  }, [myUid, swapMicStream])

  // Noise suppression / echo cancellation / auto gain — the browser's own
  // mic processing, which is the same set of WebRTC constraints behind
  // Discord's equivalent toggles. `patch` carries just the one being changed.
  //
  // applyConstraints is the fast path: it retunes the live track in place, so
  // the Web Audio source feeding the gain graph stays valid and nothing needs
  // rewiring. Browsers don't all honour it on an already-open track though,
  // so fall back to reopening the mic — the same renegotiation-free swap a
  // device change does.
  const setAudioProcessing = useCallback(async (patch) => {
    const next = { ...voicePrefsRef.current, ...patch }
    voicePrefsRef.current = next
    setVoicePrefs(next)
    saveVoicePrefs(next)
    if (!activeChannelRef.current || !myUid) return // just remembered for the next join
    const audioProcessing = audioProcessingFrom(next)
    try {
      const track = localStreamRef.current?.getAudioTracks()[0]
      if (!track) return
      await track.applyConstraints(audioProcessing)
    } catch {
      try {
        await swapMicStream({ deviceId: next.inputDeviceId, audioProcessing })
      } catch (e) {
        setConnError(`Couldn't change your microphone processing: ${e.message}`)
      }
    }
  }, [myUid, swapMicStream])

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
    activeChannel, participants, remoteStreams, speakingUids, muted, deafened, connError, joining, myUid,
    cameraOn, screenSharing, localVideoStream,
    voicePrefs, join, leave, toggleMute, toggleDeafen, toggleCamera, toggleScreenShare,
    setInputDevice, setOutputDevice, setInputVolume, setOutputVolume, setAudioProcessing,
    clearConnError: () => setConnError(null),
  }
}

// ---------- Shared voice-channel context ----------
const VoiceChannelCtx = createContext(null)

export function VoiceChannelProvider({ children }) {
  const value = useVoiceChannelEngine()
  return <VoiceChannelCtx.Provider value={value}>{children}</VoiceChannelCtx.Provider>
}

export const useVoiceChannel = () => useContext(VoiceChannelCtx)
