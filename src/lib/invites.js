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
//     unlocks the next in firestore.rules. The first write records the token in
//     users/{uid}/private/invite (a document nothing can read back), and every
//     later self-add is validated against it. Do not reorder redeemInvite's
//     writes — and never put the token on users/{uid} itself, which every
//     signed-in account can read.
//
// See docs/ROLES.md and the "Invite links" block in firestore.rules.

import {
  arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { newId } from './storage'

const PENDING_KEY = 'punx.pendingInvite'

/** Tokens are ids, not guessable strings — two newId()s for ~256 bits. */
const newToken = () => `${newId()}${newId()}`

export const inviteUrl = (token) => `${window.location.origin}/invite/${token}`

/** How long a new link lasts. Shared by both places that create one. */
export const DAY_OPTIONS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

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
 *   1. record the token in users/{uid}/private/invite — and, for a newcomer,
 *      create users/{uid} (role 'guest') in the SAME batch, which is what the
 *      rules require. Either way this is what the later steps are validated
 *      against. An existing member keeps their role: an invite link must never
 *      be able to demote an admin.
 *   2. the redemption marker, for the audit trail.
 *   3. join the group, adding only yourself.
 *   4. grant yourself each invited channel.
 *
 * The token goes in a PRIVATE document, never on users/{uid}: that document is
 * readable by every signed-in account, and the token is the secret, so storing
 * it there let anyone copy someone else's token onto their own record and join
 * their group. Nothing can read the private one back — not even you — and
 * nothing here needs to.
 *
 * Idempotent: re-running it re-writes the same values, and every step is a
 * merge or a self-add, so a half-finished redemption is fixed by retrying.
 */
export async function redeemInvite({ token, invite, user, existingProfile }) {
  const uid = user.uid
  const userRef = doc(db, 'users', uid)
  const inviteRef = doc(db, 'users', uid, 'private', 'invite')

  if (existingProfile) {
    // Already one of us — record the token so the self-adds below validate,
    // and touch nothing else.
    await setDoc(inviteRef, { token })
  } else {
    // One batch, not two writes: the rule that lets a newcomer create their
    // guest record checks that the token arrives alongside it (getAfter), so
    // neither write is legal on its own.
    const batch = writeBatch(db)
    batch.set(userRef, {
      uid,
      email: (user.email || '').toLowerCase(),
      name: user.displayName || (user.email || 'Guest').split('@')[0],
      photoURL: user.photoURL || null,
      role: 'guest',
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    })
    batch.set(inviteRef, { token })
    await batch.commit()
  }

  // Audit trail. Never fatal — a missing marker costs the admin UI a number,
  // it doesn't cost the guest their access.
  await setDoc(doc(db, 'invites', token, 'redemptions', uid), {
    uid,
    email: (user.email || '').toLowerCase(),
    redeemedAt: serverTimestamp(),
  }).catch(() => {})

  // arrayUnion, and NOT read-then-write. This is the whole reason redemption
  // works at all: a joiner cannot read the group or channel documents until
  // they're in them — that's precisely what the read rules forbid — so any
  // getDoc() here fails for exactly the people invites exist for. arrayUnion is
  // write-only and atomic, and firestore.rules sees the post-transform value,
  // so addsOnlyMeTo() can still verify the change added nobody but us.
  await updateDoc(doc(db, 'groups', invite.groupId), { memberUids: arrayUnion(uid) })

  // One failure here shouldn't cost the whole redemption — a channel may have
  // been deleted since the link was made. Collect and report instead.
  const failed = []
  for (const channelId of invite.channelIds || []) {
    try {
      await updateDoc(
        doc(db, 'groups', invite.groupId, 'channels', channelId),
        { allowUids: arrayUnion(uid) },
      )
    } catch (e) {
      console.error('[invites] could not grant channel', channelId, e)
      failed.push(channelId)
    }
  }

  const granted = (invite.channelIds || []).filter(id => !failed.includes(id))
  if (granted.length === 0 && (invite.channelIds || []).length > 0) {
    throw new Error("Joined the group, but none of the invited channels could be granted.")
  }
  return { groupId: invite.groupId, channelIds: granted }
}
