// Voice-channel signaling — mesh WebRTC, N participants, Firestore-only
// transport (no signaling server), same philosophy as lib/calls.js. This
// module is pure Firestore I/O; the WebRTC plumbing lives in lib/webrtc.js
// and the two are glued together by lib/useVoiceChannel.jsx.
//
// Deliberately NOT built on lib/calls.js: that collection's ringing/accepted
// state machine is 1:1-call-specific. Voice channels have no ring/accept
// lifecycle — participants just come and go as they join/leave a persistent
// channel — so this gets its own parallel, simpler collection pair: a
// presence roster, and pairwise offer/answer/ICE signaling.
//
// See firestore.rules `voiceParticipants`/`voiceSignals` (nested under
// `groups/{groupId}/channels/{channelId}`) for the server-enforced rules
// this file writes into.

import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { db } from './firebase'

// No heartbeat within this long → treat a roster doc as abandoned (crashed
// tab, killed process — Firestore has no onDisconnect() hook to catch this
// for us). Originally tuned much tighter (45s) on the theory that a stale
// voice roster is more visibly wrong than a stale presence dot, but that
// was too aggressive in practice: browsers throttle setInterval timers in
// backgrounded tabs (very normal for voice chat — you join, then switch to
// another tab while still talking), which can silently stall the heartbeat
// write for well over 45s with the participant still genuinely connected.
// Once pruned, every OTHER client tears down its peer connection with them
// too (see handleRosterChange in useVoiceChannel.jsx) — so being too
// aggressive here doesn't just mis-render, it actually cuts their audio.
// Matches lib/presence.jsx's battle-tested 2-minute OFFLINE_AFTER_MS, tuned
// for this exact class of problem — keep this in sync with the mirrored
// `duration.value(...)` in firestore.rules' voiceParticipants delete rule.
const STALE_MS = 2 * 60_000

function channelDoc(groupId, channelId) {
  return doc(db, 'groups', groupId, 'channels', channelId)
}
function participantsCol(groupId, channelId) {
  return collection(channelDoc(groupId, channelId), 'voiceParticipants')
}
function participantDoc(groupId, channelId, uid) {
  return doc(participantsCol(groupId, channelId), uid)
}
function signalsCol(groupId, channelId) {
  return collection(channelDoc(groupId, channelId), 'voiceSignals')
}
function signalDoc(groupId, channelId, pairKey) {
  return doc(signalsCol(groupId, channelId), pairKey)
}

// Deterministic per-pair keys/roles — same convention as dmConvoId/
// callPairKey. Pure functions of the two uids: both sides compute the same
// answer independently, with no coordination and no glare window.
export const voicePairKey = (a, b) => [a, b].sort().join('__')
export const voiceOffererUid = (a, b) => [a, b].sort()[0]

function logListenerError(name, err) {
  console.error(`[voiceChannel] ${name} listener failed:`, err)
  if (err?.code === 'failed-precondition') {
    console.info(
      `[voiceChannel] Firestore wants a composite index for "${name}". Open the URL ` +
      'in the error above and click "Create index" — until then this listener ' +
      'will never deliver data.'
    )
  }
}

// ---------- Roster ----------

// Doc id = the joiner's own uid, so a rejoin needs to survive finding a stale
// doc of its own already sitting there (crashed tab, or a `pagehide` that
// never fired).
//
// setDoc alone does NOT achieve that, however much it looks like an upsert:
// Firestore evaluates a write to an ALREADY-EXISTING doc against the `update`
// rule, not `create`, and voiceParticipants' update rule is deliberately
// narrow — heartbeat and mute/deafen/camera flags only. A full join payload
// carries `uid` and `joinedAt` too, so it gets denied, joinRoster throws, and
// useVoiceChannel's join() tears the whole session down. That reads as
// "joining instantly kicks me out", and it never recovers on its own:
// pruneStaleParticipants only runs from clients connected to that channel, so
// once a channel is empty there is nobody left to clear the doc blocking you.
//
// Deleting first sidesteps it entirely — self-delete is always permitted, and
// on a nonexistent doc it's a no-op — so the write that follows is genuinely
// always a create.
export async function joinRoster(groupId, channelId, uid) {
  await deleteDoc(participantDoc(groupId, channelId, uid)).catch(() => {})
  await setDoc(participantDoc(groupId, channelId, uid), {
    uid,
    joinedAt: serverTimestamp(),
    lastHeartbeat: serverTimestamp(),
    muted: false,
    deafened: false,
    cameraOn: false,
    screenSharing: false,
  })
}

export async function heartbeatRoster(groupId, channelId, uid) {
  await updateDoc(participantDoc(groupId, channelId, uid), { lastHeartbeat: serverTimestamp() }).catch(() => {})
}

export async function setRosterState(groupId, channelId, uid, patch) {
  await updateDoc(participantDoc(groupId, channelId, uid), patch).catch(() => {})
}

export async function leaveRoster(groupId, channelId, uid) {
  await deleteDoc(participantDoc(groupId, channelId, uid)).catch(() => {})
}

// Fires with the full current roster on every change, plus the added/removed
// uids for this change specifically — callers drive peer-connection
// lifecycle off those two lists rather than diffing the roster themselves.
// Note the *first* snapshot after attaching this listener reports every
// already-present participant as "added" (Firestore's normal behavior for a
// fresh listener) — that's exactly the "discover existing peers" step a
// join needs, so no separate one-time query is required.
export function listenParticipants(groupId, channelId, cb, onError) {
  const q = query(participantsCol(groupId, channelId), orderBy('joinedAt', 'asc'))
  return onSnapshot(
    q,
    snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const changes = snap.docChanges()
      const added = changes.filter(c => c.type === 'added').map(c => c.doc.id)
      const removed = changes.filter(c => c.type === 'removed').map(c => c.doc.id)
      cb(all, { added, removed })
    },
    err => { logListenerError('listenParticipants', err); onError?.(err) },
  )
}

// Best-effort: prune roster docs whose heartbeat is stale (crashed/killed
// tabs, since Firestore has no server-side disconnect hook). Safe for
// multiple clients to call concurrently — delete is idempotent, and
// firestore.rules re-verifies staleness server-side before allowing it.
export async function pruneStaleParticipants(groupId, channelId) {
  try {
    const snap = await getDocs(participantsCol(groupId, channelId))
    const now = Date.now()
    await Promise.all(snap.docs.map(d => {
      const hb = d.data().lastHeartbeat?.toMillis?.()
      // A serverTimestamp() write can briefly read back as unresolved right
      // after someone joins — treating that as "epoch 0" (the old `?? 0`
      // fallback) made a brand-new joiner look infinitely stale to whichever
      // other client's prune sweep happened to run in that narrow window,
      // deleting them within seconds of joining. Skip instead: an ambiguous
      // timestamp means "don't know," not "definitely gone."
      if (hb == null) return null
      return (now - hb > STALE_MS) ? deleteDoc(d.ref).catch(() => {}) : null
    }))
  } catch (e) {
    console.warn('[voiceChannel] stale-participant prune failed (non-fatal):', e.message)
  }
}

// ---------- Pairwise mesh signaling ----------

// Called only by whichever side voiceOffererUid() names the offerer for
// this pair — the other side never calls this, it just waits for the doc.
export async function createVoiceOffer(groupId, channelId, myUid, peerUid, offer) {
  const pairKey = voicePairKey(myUid, peerUid)
  const ref = signalDoc(groupId, channelId, pairKey)
  const payload = {
    uids: [myUid, peerUid].sort(),
    offererUid: voiceOffererUid(myUid, peerUid),
    offer,
    answer: null,
    createdAt: serverTimestamp(),
  }

  // Try the write first, and only clear a leftover doc if that write is
  // actually refused. Do NOT hoist the delete back out to the top.
  //
  // The problem being solved: setDoc on a doc that ALREADY EXISTS is evaluated
  // against the `update` rule, not `create`. voiceSignals' update rule permits
  // exactly one thing — the NON-offerer attaching `answer` — so an offerer
  // writing its full payload over a leftover doc is denied, and stays denied
  // forever. Leftover docs are the normal case, not an edge case: the teardown
  // that deletes them only runs on a clean leave, so any client that crashed
  // or was killed leaves one behind.
  //
  // Deleting unconditionally fixed that but caused a second bug: it opens a
  // window where the doc does not exist, and the ANSWERER's `answer` write is
  // an `update`, which matches no rule when the doc is missing. Answering takes
  // hundreds of ms (peer connection, setRemoteDescription, createAnswer), so
  // that window was wide enough to hit routinely — "Couldn't answer a
  // participant: permission-denied". Recovering only when needed keeps the
  // common path gap-free and confines the window to the rare stale case.
  try {
    await setDoc(ref, payload)
  } catch (e) {
    if (e?.code !== 'permission-denied') throw e
    await deleteDoc(ref).catch(() => {})
    await setDoc(ref, payload)
  }
  return pairKey
}

export async function attachVoiceAnswer(groupId, channelId, pairKey, answer) {
  await updateDoc(signalDoc(groupId, channelId, pairKey), { answer })
}

export async function deleteVoiceSignal(groupId, channelId, pairKey) {
  await deleteDoc(signalDoc(groupId, channelId, pairKey)).catch(() => {})
}

export async function sendVoiceIceCandidate(groupId, channelId, pairKey, fromUid, candidate) {
  await addDoc(collection(signalDoc(groupId, channelId, pairKey), 'candidates'), {
    from: fromUid,
    candidate,
    createdAt: serverTimestamp(),
  })
}

// Fires once per newly-added candidate for one specific pair (not the whole
// set each time) so the caller can just addIceCandidate() incrementally.
export function listenVoiceCandidates(groupId, channelId, pairKey, onAdd, onError) {
  const q = query(collection(signalDoc(groupId, channelId, pairKey), 'candidates'), orderBy('createdAt', 'asc'))
  return onSnapshot(
    q,
    snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') onAdd({ id: change.doc.id, ...change.doc.data() })
      })
    },
    err => { logListenerError('listenVoiceCandidates', err); onError?.(err) },
  )
}

// Every signaling doc involving me in this channel — at most N-1 docs. One
// listener drives every peer connection I'm part of: it delivers both
// incoming offers (from whichever peer is the deterministic offerer for
// that pair) and answers to offers I sent myself.
export function listenMyVoiceSignals(groupId, channelId, myUid, cb, onError) {
  const q = query(signalsCol(groupId, channelId), where('uids', 'array-contains', myUid))
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { logListenerError('listenMyVoiceSignals', err); onError?.(err) },
  )
}
