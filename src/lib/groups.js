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
export function listenChannels(groupId, cb) {
  const q = query(
    collection(db, 'groups', groupId, 'channels'),
    orderBy('createdAt', 'asc'),
  )
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
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

export async function createChannel(groupId, { name, createdBy }) {
  const colRef = collection(db, 'groups', groupId, 'channels')
  const ref = await addDoc(colRef, {
    name: name.trim().toLowerCase().replace(/\s+/g, '-'),
    type: 'text',
    createdAt: serverTimestamp(),
    createdBy,
  })
  return ref.id
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
