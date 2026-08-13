import {
  addDoc, arrayRemove, arrayUnion, collection, doc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { pathToReadKey } from './db'
import { db } from './firebase'
import { newId } from './storage'
import { PRESETS, resizeToDataURL } from './images'

// Listen to groups the user is a member of (sorted client-side to skip composite index)
export function listenMyGroups(uid, cb) {
  const q = query(
    collection(db, 'groups'),
    where('memberUids', 'array-contains', uid),
  )
  return onSnapshot(q, snap => {
    const groups = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    groups.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || 0
      const tb = b.createdAt?.toMillis?.() || 0
      return ta - tb
    })
    cb(groups)
  })
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
