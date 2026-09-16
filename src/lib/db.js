import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, limit as fbLimit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { db } from './firebase'
import { PRESETS, resizeToDataURL } from './images'
import { extractMentionedUids } from './markdown'

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
// Live window over the MOST RECENT `lim` messages.
//
// Ordered DESCENDING in the query and reversed for display, which is not a
// stylistic choice: `orderBy('createdAt', 'asc')` with a limit returns the
// OLDEST n, so a channel past the limit showed its first ever messages and
// never the recent ones, with no way to reach them. Descending takes the newest
// n, which is the window a chat actually wants.
//
// Paging works by growing `lim` and resubscribing, rather than by fetching a
// separate older page and stitching it on. One listener means edits, deletes
// and reactions stay live across the whole loaded range — with a stitched page
// only the newest slice would keep updating.
// How many messages a channel opens with, and how many more each page adds.
// Smaller than the old flat 200: opening is faster, and paging makes the rest
// reachable rather than unreachable.
export const MESSAGE_PAGE = 50

export function listenMessages(path, cb, lim = MESSAGE_PAGE) {
  const q = query(collection(db, ...path.split('/')), orderBy('createdAt', 'desc'), fbLimit(lim))
  return onSnapshot(q, (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    docs.reverse() // oldest first, the order the list renders in
    // `hasMore` is inferred from a full page: if the window is saturated there
    // is probably more behind it. It can be wrong once, on a channel whose
    // total is an exact multiple of the page size — the cost is one extra
    // fetch that returns nothing new, and the caller stops asking.
    cb(docs, { hasMore: snap.size >= lim })
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

// Send a message at the given collection path.
// Accepts:
//   text       — trimmed at send
//   imageFile  — optional File (resized + base64 embedded)
//   imageURL   — optional pre-existing URL (e.g. a picked GIF) — used as-is, skips the resize/embed step
//   replyTo    — optional message obj we're replying to; a snapshot is embedded
export async function sendMessage(path, { text, author, imageFile = null, imageURL: directImageURL = null, imageMeta: directImageMeta = null, replyTo = null }) {
  const trimmed = (text || '').trim()
  if (!trimmed && !imageFile && !directImageURL) return
  const colRef = collection(db, ...path.split('/'))

  const msgRef = doc(colRef)

  let imageURL = directImageURL
  let imageMeta = directImageMeta
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
    mentionedUids: extractMentionedUids(trimmed),
    replyTo: replyTo ? {
      messageId:  replyTo.id,
      authorUid:  replyTo.author?.uid || null,
      authorName: replyTo.author?.name || 'Unknown',
      snippet:    (replyTo.text || (replyTo.imageURL ? '[image]' : '')).slice(0, 160),
    } : null,
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
        lastMessageAuthorUid: author.uid,
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

// Listen to a container doc (dm convo or channel) — used for typing indicators.
export function listenContainer(containerPath, cb) {
  return onSnapshot(doc(db, ...containerPath.split('/')), snap => {
    cb(snap.exists() ? snap.data() : null)
  })
}

// Mark self as typing (or not) on the given container.
// Uses dot-path so we only touch `typing.{uid}`, not the whole `typing` map.
export async function setTyping(containerPath, uid, isTyping) {
  if (!uid || !containerPath) return
  try {
    await updateDoc(doc(db, ...containerPath.split('/')), {
      [`typing.${uid}`]: isTyping ? serverTimestamp() : deleteField(),
    })
  } catch { /* non-fatal */ }
}
