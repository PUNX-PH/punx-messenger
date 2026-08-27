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

/**
 * Listen to the channels in a group that `viewer` is allowed to see.
 *
 * Nobody queries this collection unfiltered any more, and the reason is worth
 * knowing before touching any of it: a Firestore query is not checked against
 * the documents it returns. The rule is evaluated once against the QUERY, with
 * a `resource` that knows only what the query's filters prove — so
 * where('private','==',false) makes that field readable as false, while an
 * unfiltered query leaves it unknown, and reading an unknown field errors,
 * which denies. firestore.rules reads `private` unguarded on purpose: that
 * error is the only thing standing between an ordinary member and every
 * private channel's name.
 *
 * So each caller runs the legs below and we merge them. Every leg is one the
 * rules can prove safe, and their union is exactly what that caller may see.
 *
 *   guest           allowUids array-contains me   (guests see nothing else)
 *   member          private == false, and allowUids array-contains me
 *   admin/oversight the above, plus private == true
 *
 * The last leg is a *guess* at admin rights, made from the group doc and the
 * caller's role — see channelViewer() in lib/auth. Guessing wrong is cheap by
 * design: the leg is optional, so a denial drops it and the rest of the list
 * still arrives. That matters because the client cannot reproduce every case
 * the rules decide (a plain workspace admin has no admin power inside a
 * developer-owned group).
 *
 * All the filters are single-field, so none of this needs a composite index.
 * Ordering is done here rather than with orderBy for the same reason.
 *
 * Build `viewer` with channelViewer(profile, group). Passing nothing yields
 * public channels only.
 */
export function listenChannels(groupId, cb, onError, viewer = null) {
  const col = collection(db, 'groups', groupId, 'channels')
  const uid = viewer?.uid || null

  const legs = viewer?.guest
    ? [{ q: query(col, where('allowUids', 'array-contains', uid)) }]
    : [
        { q: query(col, where('private', '==', false)) },
        uid && { q: query(col, where('allowUids', 'array-contains', uid)) },
        viewer?.seesPrivate
          && { q: query(col, where('private', '==', true)), optional: true },
      ].filter(Boolean)

  // One page of results per leg, null until that leg has reported. Nothing is
  // emitted until every leg has — a partial first list would flash a sidebar
  // missing half its channels, and GroupHome would redirect into whichever
  // channel happened to arrive first.
  const pages = legs.map(() => null)
  const emit = () => {
    if (pages.some(page => page === null)) return
    const byId = new Map()
    for (const page of pages) for (const ch of page) byId.set(ch.id, ch)
    cb([...byId.values()].sort(byCreatedAt))
  }

  const unsubs = legs.map((leg, i) => onSnapshot(
    leg.q,
    snap => { pages[i] = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit() },
    err => {
      if (leg.optional) {
        // Expected whenever the admin guess was wrong. Not an error the user
        // should ever see: they simply don't get the private channels.
        pages[i] = []
        emit()
        return
      }
      // Without this, a denied/broken query here just hangs GroupHome.jsx's
      // "Opening group…" screen forever with zero feedback.
      console.error('[groups] listenChannels failed:', err)
      onError?.(err)
    },
  ))
  return () => unsubs.forEach(u => u())
}

/**
 * Replace a channel's access list.
 *
 * `allowUids` is what both the rules and the sidebar read. `isPrivate` only
 * matters for non-guests: a public channel is visible to every group member
 * regardless of the list, while a private one is visible only to those on it
 * (plus admins). Guests are governed by the list alone, so inviting a guest to
 * a public channel works without making it private.
 */
export async function setChannelAccess(groupId, channelId, { isPrivate, allowUids }) {
  await updateDoc(doc(db, 'groups', groupId, 'channels', channelId), {
    private: !!isPrivate,
    allowUids: Array.from(new Set(allowUids || [])),
  })
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
    // Both written even though #general is as public as a channel gets. The
    // rules read `private` without an existence guard, so a channel without
    // the key is denied outright rather than treated as public — a new group
    // would open to an empty sidebar. See listenChannels.
    private: false,
    allowUids: [owner.uid],
    createdAt: serverTimestamp(),
    createdBy: owner.uid,
  })
  await batch.commit()

  return { groupId, generalChannelId: generalRef.id }
}

export async function createChannel(
  groupId,
  { name, createdBy, categoryId = null, type = 'text', isPrivate = false, allowUids = [] },
) {
  const colRef = collection(db, 'groups', groupId, 'channels')
  // Next position within the target category (or the uncategorized group).
  const existing = await getDocs(query(colRef, where('categoryId', '==', categoryId)))
  const maxOrder = existing.docs.reduce((m, d) => Math.max(m, d.data().order ?? -1), -1)
  // `private` and `allowUids` are always written, even for a plain public
  // channel, so the access UI never has to special-case a channel that predates
  // this feature. The creator is always on the list: a private channel nobody
  // can open is only ever a mistake.
  const ref = await addDoc(colRef, {
    name: name.trim().toLowerCase().replace(/\s+/g, '-'),
    type,
    categoryId,
    order: maxOrder + 1,
    private: !!isPrivate,
    allowUids: Array.from(new Set([...(allowUids || []), createdBy].filter(Boolean))),
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
