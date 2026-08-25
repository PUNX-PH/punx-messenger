import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDocs, limit as fbLimit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { pathToReadKey } from './db'
import { db } from './firebase'
import { newId } from './storage'
import { PRESETS, resizeToDataURL } from './images'

// Oldest first, as the rail has always shown them. Sorted client-side rather
// than with orderBy so the array-contains query below needs no composite index.
function byCreatedAt(a, b) {
  return (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)
}

// Listen to groups the user is a member of.
export function listenMyGroups(uid, cb) {
  const q = query(
    collection(db, 'groups'),
    where('memberUids', 'array-contains', uid),
  )
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byCreatedAt))
  })
}

/**
 * Every group in the workspace, membership ignored — super admins only.
 *
 * firestore.rules' canOverseeAll() is what makes the unfiltered query legal;
 * for anyone else Firestore denies the whole snapshot (one non-readable doc
 * fails the list, it is not silently filtered out), so callers must check the
 * role before reaching for this. Groups the caller isn't in come back with
 * their real memberUids, which is what lets the rail tell the two apart — see
 * isGhost in lib/auth.
 */
export function listenAllGroups(cb, onError) {
  return onSnapshot(
    query(collection(db, 'groups')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byCreatedAt)),
    err => {
      console.error('[groups] listenAllGroups failed:', err)
      onError?.(err)
    },
  )
}

// Listen to channels in a group
export function listenChannels(groupId, cb, onError) {
  const q = query(
    collection(db, 'groups', groupId, 'channels'),
    orderBy('createdAt', 'asc'),
  )
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      // Without this, a denied/broken query here just hangs GroupHome.jsx's
      // "Opening group…" screen forever with zero feedback.
      console.error('[groups] listenChannels failed:', err)
      onError?.(err)
    },
  )
}

// Listen to a single group doc
export function listenGroup(groupId, cb) {
  return onSnapshot(doc(db, 'groups', groupId), snap => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null)
  })
}

/**
 * Create a group. Optionally uploads an avatar file first.
 * Auto-creates a #general channel.
 */
export async function createGroup({ name, avatarFile, owner }) {
  const groupId = newId()

  let imageURL = null
  if (avatarFile) {
    const out = await resizeToDataURL(avatarFile, PRESETS.AVATAR)
    imageURL = out.dataURL
  }

  const batch = writeBatch(db)
  batch.set(doc(db, 'groups', groupId), {
    name: name.trim(),
    imageURL,
    bannerURL: null,
    ownerUid: owner.uid,
    adminUids: [owner.uid],
    memberUids: [owner.uid],
    createdAt: serverTimestamp(),
  })
  const generalRef = doc(collection(db, 'groups', groupId, 'channels'))
  batch.set(generalRef, {
    name: 'general',
    type: 'text',
    createdAt: serverTimestamp(),
    createdBy: owner.uid,
  })
  await batch.commit()

  return { groupId, generalChannelId: generalRef.id }
}

export async function createChannel(groupId, { name, createdBy, categoryId = null, type = 'text' }) {
  const colRef = collection(db, 'groups', groupId, 'channels')
  // Next position within the target category (or the uncategorized group).
  const existing = await getDocs(query(colRef, where('categoryId', '==', categoryId)))
  const maxOrder = existing.docs.reduce((m, d) => Math.max(m, d.data().order ?? -1), -1)
  const ref = await addDoc(colRef, {
    name: name.trim().toLowerCase().replace(/\s+/g, '-'),
    type,
    categoryId,
    order: maxOrder + 1,
    createdAt: serverTimestamp(),
    createdBy,
  })
  return ref.id
}

// Firestore has no cascading delete: dropping a channel doc on its own would
// orphan everything nested under it. Those docs stay live at a path group
// members can still read, and still count against storage — they're just
// invisible in the UI, which is the worst of both. So clear the
// subcollections first, then the channel itself.
const DELETE_PAGE = 400 // a write batch caps out at 500

// Paged rather than one getDocs of everything, so deleting a channel with a
// long history doesn't try to hold every message in memory at once.
async function deleteAllDocs(colRef) {
  for (;;) {
    const snap = await getDocs(query(colRef, fbLimit(DELETE_PAGE)))
    if (snap.empty) return
    const batch = writeBatch(db)
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
    if (snap.size < DELETE_PAGE) return
  }
}

/**
 * Delete a channel and everything under it. Callers must gate this on admin
 * rights themselves for the UI's sake; `firestore.rules` enforces it for
 * real (group admin or workspace admin, same check as channel create).
 *
 * The voice subcollections are best-effort: they're ephemeral signaling
 * state that connected clients clean up for themselves on leave, so failing
 * to clear them is not worth aborting the delete over — losing the channel
 * but keeping its messages would be the genuinely bad outcome.
 */
export async function deleteChannel(groupId, channelId) {
  const channelRef = doc(db, 'groups', groupId, 'channels', channelId)

  await deleteAllDocs(collection(channelRef, 'messages'))

  try {
    await deleteAllDocs(collection(channelRef, 'voiceParticipants'))
    // Each signaling doc carries its own `candidates` subcollection, which
    // has to go before the parent or it's orphaned in turn.
    const signals = await getDocs(collection(channelRef, 'voiceSignals'))
    for (const sig of signals.docs) await deleteAllDocs(collection(sig.ref, 'candidates'))
    await deleteAllDocs(collection(channelRef, 'voiceSignals'))
  } catch (e) {
    console.warn('[groups] voice signaling cleanup failed (non-fatal):', e.message)
  }

  await deleteDoc(channelRef)
}

// ───────── Channel categories (Discord-style grouping) ─────────

export function listenCategories(groupId, cb) {
  const q = query(collection(db, 'groups', groupId, 'categories'), orderBy('order', 'asc'))
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
}

export async function createCategory(groupId, { name, createdBy }) {
  const existing = await getDocs(collection(db, 'groups', groupId, 'categories'))
  const maxOrder = existing.docs.reduce((m, d) => Math.max(m, d.data().order ?? -1), -1)
  const ref = await addDoc(collection(db, 'groups', groupId, 'categories'), {
    name: name.trim(),
    order: maxOrder + 1,
    createdAt: serverTimestamp(),
    createdBy,
  })
  return ref.id
}

export async function renameCategory(groupId, categoryId, name) {
  await updateDoc(doc(db, 'groups', groupId, 'categories', categoryId), { name: name.trim() })
}

// Channels in the deleted category fall back to uncategorized rather than
// being deleted themselves.
export async function deleteCategory(groupId, categoryId) {
  const chSnap = await getDocs(query(collection(db, 'groups', groupId, 'channels'), where('categoryId', '==', categoryId)))
  const batch = writeBatch(db)
  chSnap.docs.forEach(d => batch.update(d.ref, { categoryId: null }))
  batch.delete(doc(db, 'groups', groupId, 'categories', categoryId))
  await batch.commit()
}

// orderedIds is the full list of category ids in their new top-to-bottom order.
export async function reorderCategories(groupId, orderedIds) {
  const batch = writeBatch(db)
  orderedIds.forEach((id, i) => batch.update(doc(db, 'groups', groupId, 'categories', id), { order: i }))
  await batch.commit()
}

// Moves a channel into `categoryId` (null = uncategorized) and persists the
// full new order for every channel in that resulting list — used for both
// "reorder within the same category" and "drag into a different category".
export async function reorderChannelsInCategory(groupId, categoryId, orderedChannelIds) {
  const batch = writeBatch(db)
  orderedChannelIds.forEach((id, i) =>
    batch.update(doc(db, 'groups', groupId, 'channels', id), { categoryId, order: i }))
  await batch.commit()
}

// Groups + sorts channels for display: uncategorized channels first (fixed
// position, not part of category reordering — matches Discord), then each
// category (in its own order) with its channels (in their own order).
export function groupChannelsByCategory(channels, categories) {
  const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0)
  // Voice channels always sort below text channels within a list — same
  // Discord convention regardless of drag-reorder history, so type takes
  // priority over `order` and only breaks ties within the same type.
  const sortChannels = (a, b) => {
    const typeRank = (c) => c.type === 'voice' ? 1 : 0
    return typeRank(a) - typeRank(b) || sortByOrder(a, b)
  }
  const byCategory = new Map()
  const uncategorized = []
  for (const c of channels) {
    if (c.categoryId) {
      if (!byCategory.has(c.categoryId)) byCategory.set(c.categoryId, [])
      byCategory.get(c.categoryId).push(c)
    } else {
      uncategorized.push(c)
    }
  }
  uncategorized.sort(sortChannels)
  const sortedCategories = [...categories].sort(sortByOrder).map(cat => ({
    ...cat,
    channels: (byCategory.get(cat.id) || []).sort(sortChannels),
  }))
  return { uncategorized, categories: sortedCategories }
}

export async function addMember(groupId, uid) {
  await setDoc(doc(db, 'groups', groupId), {
    memberUids: arrayUnion(uid),
  }, { merge: true })
}

export async function removeMember(groupId, uid) {
  // Remove from both members and admins
  await setDoc(doc(db, 'groups', groupId), {
    memberUids: arrayRemove(uid),
    adminUids:  arrayRemove(uid),
  }, { merge: true })
}

export async function setGroupAdmin(groupId, uid, isAdmin) {
  await setDoc(doc(db, 'groups', groupId), {
    adminUids: isAdmin ? arrayUnion(uid) : arrayRemove(uid),
  }, { merge: true })
}

// Mark every channel in the group as read for the current user.
export async function markGroupAsRead(uid, groupId) {
  const channelsSnap = await getDocs(collection(db, 'groups', groupId, 'channels'))
  if (channelsSnap.empty) return
  const updates = {}
  for (const c of channelsSnap.docs) {
    updates[`lastRead.${pathToReadKey(`groups/${groupId}/channels/${c.id}`)}`] = serverTimestamp()
  }
  await updateDoc(doc(db, 'users', uid), updates)
}

// Toggle whether the current user has muted this group.
export async function toggleMuteGroup(uid, groupId, mute) {
  await updateDoc(doc(db, 'users', uid), {
    mutedGroups: mute ? arrayUnion(groupId) : arrayRemove(groupId),
  })
}

// Remove yourself from a group. Owners can't leave (must transfer first).
export async function leaveGroup(groupId, uid, ownerUid) {
  if (ownerUid === uid) {
    throw new Error("You're the owner — transfer ownership before leaving.")
  }
  await updateDoc(doc(db, 'groups', groupId), {
    memberUids: arrayRemove(uid),
    adminUids:  arrayRemove(uid),
  })
}

export async function updateGroup(groupId, updates) {
  await setDoc(doc(db, 'groups', groupId), updates, { merge: true })
}

export async function updateGroupAvatar(groupId, file) {
  const out = await resizeToDataURL(file, PRESETS.AVATAR)
  await updateGroup(groupId, { imageURL: out.dataURL })
}

export async function updateGroupBanner(groupId, file) {
  if (file === null) {
    await updateGroup(groupId, { bannerURL: null })
    return
  }
  const out = await resizeToDataURL(file, PRESETS.BANNER)
  await updateGroup(groupId, { bannerURL: out.dataURL })
}
