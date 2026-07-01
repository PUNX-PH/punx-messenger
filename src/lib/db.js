import {
  addDoc, collection, deleteDoc, doc, getDoc, limit as fbLimit, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { db } from './firebase'
import { PRESETS, resizeToDataURL } from './images'

// Deterministic DM convo id from two uids
export const dmConvoId = (a, b) => [a, b].sort().join('__')

// Listen to all users (workspace directory)
export function listenUsers(cb) {
  const q = query(collection(db, 'users'), orderBy('name'))
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// Ensure DM convo doc exists, return its id
export async function ensureDmConvo(me, other) {
  const id = dmConvoId(me.uid, other.id)
  const ref = doc(db, 'dms', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      members: [me.uid, other.id].sort(),
      memberInfo: {
        [me.uid]:    { name: me.name,    photoURL: me.photoURL || null },
        [other.id]:  { name: other.name, photoURL: other.photoURL || null },
      },
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: '',
    })
  }
  return id
}

// Listen to messages in a path
export function listenMessages(path, cb, lim = 200) {
  const q = query(collection(db, ...path.split('/')), orderBy('createdAt', 'asc'), fbLimit(lim))
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// Encode a container path into a safe Firestore map key.
// "dms/xxx" -> "dms__xxx"; "groups/xxx/channels/yyy" -> "groups__xxx__channels__yyy"
export const pathToReadKey = (containerPath) => containerPath.replace(/\//g, '__')

// Mark a channel or DM convo as read by the current user.
// `containerPath` is the path WITHOUT trailing /messages (e.g. "dms/abc", "groups/x/channels/y").
export async function markRead(uid, containerPath) {
  if (!uid || !containerPath) return
  const key = pathToReadKey(containerPath)
  await updateDoc(doc(db, 'users', uid), {
    [`lastRead.${key}`]: serverTimestamp(),
  })
}

// Listen to all DM convos the current user is in.
// Returns a map keyed by the *other* member's uid → convo doc.
export function listenMyDmConvos(uid, cb) {
  const q = query(collection(db, 'dms'), where('members', 'array-contains', uid))
  return onSnapshot(q, snap => {
    const byOther = {}
    for (const d of snap.docs) {
      const data = { id: d.id, ...d.data() }
      const otherUid = (data.members || []).find(m => m !== uid)
      if (otherUid) byOther[otherUid] = data
    }
    cb(byOther)
  })
}

// Send a message at the given collection path
// Accepts an optional `imageFile` (File) — uploads it to Storage at the message's path
export async function sendMessage(path, { text, author, imageFile = null }) {
  const trimmed = (text || '').trim()
  if (!trimmed && !imageFile) return
  const colRef = collection(db, ...path.split('/'))

  const msgRef = doc(colRef)

  let imageURL = null
  let imageMeta = null
  if (imageFile) {
    const out = await resizeToDataURL(imageFile, PRESETS.MESSAGE_IMAGE)
    imageURL = out.dataURL
    imageMeta = {
      width: out.width,
      height: out.height,
      approxBytes: out.approxBytes,
      originalName: imageFile.name,
    }
  }

  await setDoc(msgRef, {
    text: trimmed,
    imageURL,
    imageMeta,
    author: {
      uid: author.uid,
      name: author.name,
      photoURL: author.photoURL || null,
    },
    createdAt: serverTimestamp(),
    pinned: false,
  })

  // Update parent container metadata so sidebars can show unread state.
  // These are non-fatal — the message has already been written; if the user
  // lacks permission to bump the parent (or the network blips), the message
  // still appears for them and others, the rail/sidebar just won't refresh
  // their lastMessageAt until the next send.
  try {
    if (path.startsWith('dms/')) {
      const convoId = path.split('/')[1]
      await setDoc(doc(db, 'dms', convoId), {
        lastMessageAt: serverTimestamp(),
        lastMessageText: trimmed || '📷 Image',
      }, { merge: true })
    } else if (path.startsWith('groups/') && path.includes('/channels/')) {
      const parts = path.split('/')
      const groupId = parts[1]
      const channelId = parts[3]
      await setDoc(doc(db, 'groups', groupId, 'channels', channelId), {
        lastMessageAt: serverTimestamp(),
      }, { merge: true })
    }
  } catch (e) {
    console.warn('[sendMessage] parent metadata bump failed (non-fatal):', e.message)
  }
}

// Compare lastMessageAt with lastRead → unread? Either may be a Firestore Timestamp.
export const isUnread = (lastMessageAt, lastReadAt) => {
  if (!lastMessageAt) return false
  const m = lastMessageAt.toMillis?.() ?? 0
  const r = lastReadAt?.toMillis?.() ?? 0
  return m > r
}

// Toggle the pinned flag on a single message
// messagePath e.g. 'dms/<convoId>/messages/<msgId>'
export async function setMessagePinned(messagePath, pinned) {
  await updateDoc(doc(db, ...messagePath.split('/')), { pinned: !!pinned })
}

// Toggle a reaction on a message. `key` is either a unicode emoji (e.g. "👍")
// or a custom-emoji token (e.g. ":party:"). Last writer wins under concurrent
// taps — acceptable for reactions.
export async function toggleReaction(messagePath, key, uid) {
  const ref = doc(db, ...messagePath.split('/'))
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const reactions = { ...(snap.data().reactions || {}) }
  const uids = Array.isArray(reactions[key]) ? [...reactions[key]] : []
  const i = uids.indexOf(uid)
  if (i >= 0) {
    uids.splice(i, 1)
    if (uids.length === 0) delete reactions[key]
    else reactions[key] = uids
  } else {
    reactions[key] = [...uids, uid]
  }
  await updateDoc(ref, { reactions })
}

// Edit message text. Server-side rules enforce author-only.
export async function editMessageText(messagePath, text) {
  await updateDoc(doc(db, ...messagePath.split('/')), {
    text: (text || '').trim(),
    editedAt: serverTimestamp(),
  })
}

// Delete a message (rules: author, group admin, or workspace admin)
export async function deleteMessage(messagePath) {
  await deleteDoc(doc(db, ...messagePath.split('/')))
}
