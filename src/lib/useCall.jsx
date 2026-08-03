// Glues lib/calls.js (Firestore signaling) to lib/webrtc.js (RTCPeerConnection)
// behind one hook, shared app-wide via context — same pattern as useAuth/
// useUsers/useEmojis: a single <CallProvider> runs the engine once (mounted
// in App.jsx), every consumer (CallManager, CallButtons, ...) just reads it,
// so there's only ever one live signaling/PC session per client. See
// firestore.rules `match /calls/{callId}` for the server-enforced state
// machine this reacts to.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth'
import {
  acceptCall, cancelCall, cleanupCallCandidates, createCall, declineCall,
  endCall, listenCall, listenIceCandidates, listenMyActiveCall, markFailed,
  markMissed, newCallId, sendIceCandidate, sweepStaleOutboundCalls,
} from './calls'
import { createPeerConnection, getLocalStream, stopStream } from './webrtc'

const NO_ANSWER_TIMEOUT_MS = 45_000
const TERMINAL_STATES = ['declined', 'cancelled', 'missed', 'ended', 'failed']

function useCallEngine() {
  const { profile } = useAuth()
  const myUid = profile?.id

  const [activeCalls, setActiveCalls] = useState([])
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [connError, setConnError] = useState(null)

  // Mutable session state that must never go stale inside async callbacks —
  // kept in refs, mirrored to state only where the UI needs to re-render.
  const pcRef = useRef(null)
  const localStreamRef = useRef(null)
  const callIdRef = useRef(null)
  const roleRef = useRef(null) // 'caller' | 'callee'
  const unsubCallRef = useRef(null)
  const unsubIceRef = useRef(null)
  const noAnswerTimerRef = useRef(null)
  const appliedCandidateIdsRef = useRef(new Set())
  const pendingRemoteCandidatesRef = useRef([])

  const call = activeCalls[0] || null

  // ---- My non-terminal calls, for the whole authenticated session ----
  useEffect(() => {
    if (!myUid) { setActiveCalls([]); return }
    sweepStaleOutboundCalls(myUid)
    return listenMyActiveCall(myUid, setActiveCalls, (err) => {
      // If this listener is broken (e.g. a missing Firestore composite
      // index), calls can be created but this client will never learn
      // about them — surface that instead of failing silently.
      setConnError(
        err?.code === 'failed-precondition'
          ? 'Calling isn’t set up yet — a required Firestore index is missing. Check the browser console for a link to create it.'
          : `Calling is unavailable right now: ${err?.message || err}`
      )
    })
  }, [myUid])

  const setLocalStreamBoth = (s) => { localStreamRef.current = s; setLocalStream(s) }

  const teardown = useCallback(() => {
    clearTimeout(noAnswerTimerRef.current)
    unsubCallRef.current?.(); unsubCallRef.current = null
    unsubIceRef.current?.(); unsubIceRef.current = null
    pcRef.current?.close(); pcRef.current = null
    stopStream(localStreamRef.current)
    localStreamRef.current = null
    callIdRef.current = null
    roleRef.current = null
    appliedCandidateIdsRef.current = new Set()
    pendingRemoteCandidatesRef.current = []
    setLocalStream(null)
    setRemoteStream(null)
    setMuted(false)
    setCameraOff(false)
  }, [])

  const flushPendingCandidates = (pc) => {
    const pending = pendingRemoteCandidatesRef.current
    pendingRemoteCandidatesRef.current = []
    pending.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}))
  }

  // Listens to the call doc (state transitions) + candidates subcollection
  // for whichever call my current pc session belongs to.
  const attachSignalingListeners = useCallback((callId) => {
    unsubCallRef.current = listenCall(callId, async (doc) => {
      if (!doc) return
      const pc = pcRef.current
      if (!pc) return

      if (doc.state === 'accepted' && roleRef.current === 'caller' && !pc.currentRemoteDescription) {
        clearTimeout(noAnswerTimerRef.current)
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(doc.answer))
          flushPendingCandidates(pc)
        } catch (e) {
          setConnError(e.message)
          markFailed(callId, myUid).catch(() => {})
        }
      }

      if (TERMINAL_STATES.includes(doc.state)) {
        cleanupCallCandidates(callId).catch(() => {})
        teardown()
      }
    }, (err) => {
      setConnError(`Lost track of this call: ${err?.message || err}`)
      teardown()
    })

    unsubIceRef.current = listenIceCandidates(callId, (candDoc) => {
      if (candDoc.from === myUid) return
      if (appliedCandidateIdsRef.current.has(candDoc.id)) return
      appliedCandidateIdsRef.current.add(candDoc.id)
      const pc = pcRef.current
      if (pc?.remoteDescription) {
        pc.addIceCandidate(new RTCIceCandidate(candDoc.candidate)).catch(() => {})
      } else {
        pendingRemoteCandidatesRef.current.push(candDoc.candidate)
      }
    }, (err) => setConnError(`Connection signaling failed: ${err?.message || err}`))
  }, [myUid, teardown])

  // callIdRef.current must already be set before this runs (both startCall
  // and accept() set it before creating the peer connection) so these
  // closures never race a not-yet-known call id.
  const setupPeerConnection = () => {
    const pc = createPeerConnection()
    pcRef.current = pc

    const remote = new MediaStream()
    pc.ontrack = (e) => {
      remote.addTrack(e.track)
      setRemoteStream(new MediaStream(remote.getTracks()))
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) sendIceCandidate(callIdRef.current, myUid, e.candidate.toJSON()).catch(() => {})
    }
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') markFailed(callIdRef.current, myUid).catch(() => {})
    }
    return pc
  }

  // ---- Glare: I authored a call doc that lost the tie-break — cancel it
  // myself (see firestore.rules comments; each side resolves independently). ----
  useEffect(() => {
    if (!myUid || activeCalls.length < 2) return
    activeCalls.slice(1).forEach(loser => {
      if (loser.callerUid !== myUid) return
      cancelCall(loser.id, myUid).catch(() => {})
      if (callIdRef.current === loser.id) teardown()
    })
  }, [activeCalls, myUid, teardown])

  // ---- Busy: a fresh incoming ring arrives while I'm already accepted
  // elsewhere — auto-decline it (no pc was ever created for it). ----
  useEffect(() => {
    if (!myUid || !call) return
    const alreadyOnACall = activeCalls.some(c => c.state === 'accepted' && c.id !== call.id)
    if (alreadyOnACall && call.state === 'ringing' && call.calleeUid === myUid) {
      declineCall(call.id, myUid).catch(() => {})
    }
  }, [activeCalls, call, myUid])

  // ---- Orphan cleanup: this call doc is still ringing/accepted in
  // Firestore, but nothing in *this* page load created its peer connection
  // (e.g. the tab refreshed mid-call — the browser correctly drops the local
  // camera/mic + RTCPeerConnection, but never told Firestore the call ended).
  // v1 has no reconnect/renegotiation flow, so there's no way to resume it —
  // end it instead of leaving a dead "connected" black screen or an
  // unusable stale ring. A genuinely fresh incoming ring is exempt, since
  // that's the normal "someone's calling me" case accept() will claim.
  useEffect(() => {
    if (!myUid || !call) return
    if (callIdRef.current === call.id) return // I'm actively driving this call
    if (call.state === 'ringing' && call.calleeUid === myUid) return // legit fresh incoming ring
    if (call.state === 'accepted') markFailed(call.id, myUid).catch(() => {})
    else if (call.state === 'ringing' && call.callerUid === myUid) cancelCall(call.id, myUid).catch(() => {})
  }, [call, myUid])

  const startCall = useCallback(async (otherUid, callType = 'video') => {
    if (!myUid || call) return // v1: one call at a time
    setConnError(null)
    const callId = newCallId()
    callIdRef.current = callId
    roleRef.current = 'caller'
    try {
      const stream = await getLocalStream({ video: callType === 'video' })
      setLocalStreamBoth(stream)
      const pc = setupPeerConnection()
      stream.getTracks().forEach(t => pc.addTrack(t, stream))

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      await createCall({
        callId,
        callerUid: myUid,
        calleeUid: otherUid,
        offer: { sdp: offer.sdp, type: offer.type },
        type: callType,
      })

      attachSignalingListeners(callId)
      noAnswerTimerRef.current = setTimeout(() => {
        markMissed(callId, myUid).catch(() => {})
      }, NO_ANSWER_TIMEOUT_MS)
    } catch (e) {
      setConnError(e.message || 'Could not start the call.')
      teardown()
    }
  }, [myUid, call, attachSignalingListeners, teardown])

  const accept = useCallback(async () => {
    if (!call || call.state !== 'ringing' || call.calleeUid !== myUid) return
    setConnError(null)
    callIdRef.current = call.id
    roleRef.current = 'callee'
    try {
      const stream = await getLocalStream({ video: call.type === 'video' })
      setLocalStreamBoth(stream)
      const pc = setupPeerConnection()
      stream.getTracks().forEach(t => pc.addTrack(t, stream))

      await pc.setRemoteDescription(new RTCSessionDescription(call.offer))
      attachSignalingListeners(call.id) // remoteDescription already set — candidates apply immediately

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await acceptCall(call.id, { sdp: answer.sdp, type: answer.type })
    } catch (e) {
      setConnError(e.message || 'Could not accept the call.')
      markFailed(call.id, myUid).catch(() => {})
      teardown()
    }
  }, [call, myUid, attachSignalingListeners, teardown])

  const decline = useCallback(async () => {
    if (!call) return
    await declineCall(call.id, myUid).catch(() => {})
    teardown()
  }, [call, myUid, teardown])

  const cancel = useCallback(async () => {
    if (!call) return
    await cancelCall(call.id, myUid).catch(() => {})
    teardown()
  }, [call, myUid, teardown])

  const hangup = useCallback(async () => {
    const id = callIdRef.current
    if (!id) return
    await endCall(id, myUid).catch(() => {})
    teardown()
  }, [myUid, teardown])

  // Single "end the call, whatever phase it's in" action for a unified button.
  const endActiveCall = useCallback(() => {
    if (!call) return
    if (call.state === 'ringing') return call.callerUid === myUid ? cancel() : decline()
    if (call.state === 'accepted') return hangup()
  }, [call, myUid, cancel, decline, hangup])

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }, [])

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setCameraOff(!track.enabled)
  }, [])

  // Tear down on sign-out / app close.
  useEffect(() => () => teardown(), [teardown])

  // A call this page load isn't actively driving (see the orphan-cleanup
  // effect above) renders as idle immediately, rather than flashing a dead
  // "connected"/"outgoing" UI while the cleanup write is still in flight.
  const isMine = !!call && callIdRef.current === call.id
  const isFreshIncomingRing = !!call && call.state === 'ringing' && call.calleeUid === myUid

  const status = !call || (!isMine && !isFreshIncomingRing) ? 'idle'
    : call.state === 'accepted' ? 'connected'
    : call.callerUid === myUid ? 'outgoing'
    : 'incoming'

  return {
    call, status, myUid, localStream, remoteStream, muted, cameraOff, connError,
    startCall, accept, decline, cancel, hangup, endActiveCall,
    toggleMute, toggleCamera, clearConnError: () => setConnError(null),
  }
}

// ---------- Shared call context ----------
const CallCtx = createContext(null)

export function CallProvider({ children }) {
  const value = useCallEngine()
  return <CallCtx.Provider value={value}>{children}</CallCtx.Provider>
}

export const useCall = () => useContext(CallCtx)
