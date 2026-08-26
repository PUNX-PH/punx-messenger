// Channel invite links — Discord-style.
//
// An invite is one document whose ID is the secret: `invites/{token}`, handed
// out as /invite/<token>. Reusable until it expires or is revoked.
//
// The two things worth understanding before changing any of this:
//
//  1. The person opening the link may be a total outsider with no access to
//     anything yet. They can read the invite document (its id is the secret)
//     and nothing else — not even the group's name. That is why groupName and
//     channelNames are denormalised onto the invite: the accept screen has to
//     be able to describe what they're joining from this one document.
//
//  2. Redemption is done BY the joiner, in a fixed order, because each step
//     unlocks the next in firestore.rules. Writing their users doc is what
//     records the token as `invitedVia`, and every later self-add is validated
//     against it. Do not reorder redeemInvite's writes.
//
// See docs/ROLES.md and the "Invite links" block in firestore.rules.

import {
  collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp,
  setDoc, updateDoc, where,
} from 'firebase/firestore'
import { db } from './firebase'
import { newId } from './storage'

const PENDING_KEY = 'punx.pendingInvite'

/** Tokens are ids, not guessable strings — two newId()s for ~256 bits. */
const newToken = () => `${newId()}${newId()}`

export const inviteUrl = (token) => `${window.location.origin}/invite/${token}`

// ── Pending-invite handoff ──
//
// Sign-in bounces through Google and back, and an outsider has no readable
// profile until they've redeemed. So the token is parked in sessionStorage on
// the way in: AuthProvider consults it to decide whether an unrecognised
// address is a stranger to turn away or an invitee mid-flight.
export function setPendingInvite(token) {
  try { sessionStorage.setItem(PENDING_KEY, token) } catch {}
}
export function getPendingInvite() {
  try { return sessionStorage.getItem(PENDING_KEY) } catch { return null }
}
export function clearPendingInvite() {
  try { sessionStorage.removeItem(PENDING_KEY) } catch {}
}

/**
 * Create a link granting the given channels in one group.
 * `days` is how long it stays valid; expiry is stored as a real timestamp so
 * the rules can compare it against request.time rather than trusting a client.
 */
export async function createInvite({ group, channels, createdBy, days = 7 }) {
  const token = newToken()
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  await setDoc(doc(db, 'invites', token), {
    groupId: group.id,
    groupName: group.name || 'a group',
    channelIds: channels.map(c => c.id),
    channelNames: channels.map(c => c.name),
    createdBy,
    createdAt: serverTimestamp(),
    expiresAt,
    revoked: false,
  })
  return { token, url: inviteUrl(token) }
}

/** Single-document read. Returns null when the token is unknown. */
export async function fetchInvite(token) {
  if (!token) return null
  const snap = await getDoc(doc(db, 'invites', token))
  return snap.exists() ? { token: snap.id, ...snap.data() } : null
}

/**
 * Live list of a group's invites, for the management UI. Admins only — the
 * rules refuse `list` on the whole collection, so this is scoped by groupId.
 */
export function listenGroupInvites(groupId, cb, onError) {
  return onSnapshot(
    query(collection(db, 'invites'), where('groupId', '==', groupId)),
    snap => cb(snap.docs.map(d => ({ token: d.id, ...d.data() }))),
    err => { console.error('[invites] listen failed:', err); onError?.(err) },
  )
}

/** Kill a link. `revoked` is the only field the rules let anyone change. */
export async function revokeInvite(token) {
  await updateDoc(doc(db, 'invites', token), { revoked: true })
}

export const inviteIsLive = (inv) => {
  if (!inv || inv.revoked) return false
  const ms = inv.expiresAt?.toMillis?.() ?? new Date(inv.expiresAt).getTime()
  return Number.isFinite(ms) && ms > Date.now()
}

export async function countRedemptions(token) {
  const snap = await getDocs(collection(db, 'invites', token, 'redemptions'))
  return snap.size
}

/**
 * Redeem an invite as the signed-in user.
 *
 * Order matters and is enforced by the rules:
 *   1. users/{uid} — creates the doc for a newcomer (role 'guest'), or just
 *      stamps `invitedVia` on an existing one. Either way this is what the
 *      later steps are validated against. An existing member keeps their role:
 *      an invite link must never be able to demote an admin.
 *   2. the redemption marker, for the audit trail.
 *   3. join the group, adding only yourself.
 *   4. grant yourself each invited channel.
 *
 * Idempotent: re-running it re-writes the same values, and every step is a
 * merge or a self-add, so a half-finished redemption is fixed by retrying.
 */
export async function redeemInvite({ token, invite, user, existingProfile }) {
  const uid = user.uid
  const userRef = doc(db, 'users', uid)

  if (existingProfile) {
    // Already one of us — record the token so the self-adds below validate,
    // and touch nothing else.
    await updateDoc(userRef, { invitedVia: token })
  } else {
    await setDoc(userRef, {
      uid,
      email: (user.email || '').toLowerCase(),
      name: user.displayName || (user.email || 'Guest').split('@')[0],
      photoURL: user.photoURL || null,
      role: 'guest',
      invitedVia: token,
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    })
  }

  // Audit trail. Never fatal — a missing marker costs the admin UI a number,
  // it doesn't cost the guest their access.
  await setDoc(doc(db, 'invites', token, 'redemptions', uid), {
    uid,
    email: (user.email || '').toLowerCase(),
    redeemedAt: serverTimestamp(),
  }).catch(() => {})

  const groupRef = doc(db, 'groups', invite.groupId)
  const groupSnap = await getDoc(groupRef)
  const members = groupSnap.data()?.memberUids || []
  if (!members.includes(uid)) {
    await updateDoc(groupRef, { memberUids: [...members, uid] })
  }

  for (const channelId of invite.channelIds || []) {
    const chRef = doc(db, 'groups', invite.groupId, 'channels', channelId)
    const chSnap = await getDoc(chRef)
    if (!chSnap.exists()) continue
    const allow = chSnap.data().allowUids || []
    if (allow.includes(uid)) continue
    await updateDoc(chRef, { allowUids: [...allow, uid] })
  }

  return { groupId: invite.groupId, channelIds: invite.channelIds || [] }
}
