// Bot registry — the app's half of the bot access points.
//
// A bot is two documents plus a secret:
//   bots/{botUid}                      public config: name, scopes, enabled
//   bots/{botUid}/private/credentials  the API key's SHA-256, write-only
//   users/{botUid}                     type:'bot', so it renders as a normal
//                                      author / member / voice participant
//
// The uid is generated here rather than by Firebase Auth: a custom token names
// its own subject (see workers/src/routes/bots.js), so the account springs
// into existence with this uid the first time the bot redeems its key. That's
// what lets an admin register a bot — and add it to groups — before it has
// ever connected.
//
// See docs/BOTS.md for the contract the bot side codes against.

import {
  collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { newId } from './storage'

/**
 * Everything a bot can be granted. Reading is deliberately NOT a scope: a bot
 * sees exactly the groups an admin has added it to, no more and no less, the
 * same way a person does. Scopes only ever grant writes — which keeps them
 * checkable in firestore.rules with one extra document read.
 *
 * KEEP IN SYNC with botCan()'s call sites in firestore.rules.
 */
export const BOT_SCOPES = [
  {
    id: 'messages:write',
    label: 'Post messages',
    hint: 'Send, edit and delete its own messages in channels it can see.',
  },
  {
    id: 'reactions:write',
    label: 'React and pin',
    hint: 'Add emoji reactions, and pin or unpin messages.',
  },
  {
    id: 'dm:write',
    label: 'Direct messages',
    hint: 'Start a DM with someone and send them messages.',
  },
  {
    id: 'voice:join',
    label: 'Join voice channels',
    hint: 'Connect to voice channels as a participant. Required for music playback.',
  },
  {
    id: 'channels:manage',
    label: 'Manage channels',
    hint: 'Create, rename and delete channels and categories.',
  },
  {
    id: 'members:manage',
    label: 'Manage members',
    hint: 'Add and remove group members. Cannot touch admins or ownership.',
  },
]

export const BOT_SCOPE_IDS = BOT_SCOPES.map(s => s.id)

const KEY_PREFIX = 'punxbot_'

// 32 bytes of CSPRNG, hex — the same shape workers/src/routes/bots.js expects
// on the way back in. Keep the two in sync if this ever changes.
function randomSecret(byteLength = 32) {
  const buf = new Uint8Array(byteLength)
  crypto.getRandomValues(buf)
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function botsCol() { return collection(db, 'bots') }
function botDoc(botUid) { return doc(db, 'bots', botUid) }
function botCredentialsDoc(botUid) { return doc(db, 'bots', botUid, 'private', 'credentials') }

export function listenBots(cb, onError) {
  return onSnapshot(
    query(botsCol(), orderBy('createdAt', 'asc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('[bots] listenBots failed:', err)
      onError?.(err)
    },
  )
}

/**
 * Register a bot and issue its first API key.
 *
 * The plaintext key is returned ONCE and never stored — only its hash goes to
 * Firestore, in a subcollection nothing can read back. If it's lost, rotate.
 */
export async function createBot({ name, description = '', scopes = [], createdBy }) {
  const botUid = newId()
  const apiKey = `${KEY_PREFIX}${botUid}_${randomSecret()}`
  const keyHash = await sha256Hex(apiKey)
  const cleanName = name.trim()

  const batch = writeBatch(db)
  batch.set(botDoc(botUid), {
    uid: botUid,
    name: cleanName,
    description: description.trim(),
    scopes: scopes.filter(s => BOT_SCOPE_IDS.includes(s)),
    enabled: true,
    commands: [], // Phase 3 — slash commands the bot publishes
    createdAt: serverTimestamp(),
    createdBy,
  })
  batch.set(botCredentialsDoc(botUid), { keyHash, rotatedAt: serverTimestamp() })
  // The mirror /users doc is what makes the rest of the app able to stay
  // completely unaware that bots exist — message authors, member lists and
  // voice tiles all resolve uids through useUsers() and will find this.
  batch.set(doc(db, 'users', botUid), {
    uid: botUid,
    name: cleanName,
    email: null,
    photoURL: null,
    role: 'employee', // a bot's power comes from scopes, never from a role
    type: 'bot',
    botOwnerUid: createdBy,
    createdAt: serverTimestamp(),
  })
  await batch.commit()

  return { botUid, apiKey }
}

/** Issue a fresh key and invalidate the old one. Returned once, as above. */
export async function rotateBotKey(botUid) {
  const apiKey = `${KEY_PREFIX}${botUid}_${randomSecret()}`
  await setDoc(botCredentialsDoc(botUid), {
    keyHash: await sha256Hex(apiKey),
    rotatedAt: serverTimestamp(),
  })
  return apiKey
}

/**
 * Kill switch. firestore.rules re-reads `enabled` on every request rather
 * than trusting the bot's token, so this cuts a running bot off within
 * seconds instead of at its next token refresh.
 */
export async function setBotEnabled(botUid, enabled) {
  await updateDoc(botDoc(botUid), { enabled })
}

export async function setBotScopes(botUid, scopes) {
  await updateDoc(botDoc(botUid), { scopes: scopes.filter(s => BOT_SCOPE_IDS.includes(s)) })
}

export async function updateBotProfile(botUid, { name, description, photoURL }) {
  const patch = {}
  if (typeof name === 'string') patch.name = name.trim()
  if (typeof description === 'string') patch.description = description.trim()
  if (photoURL !== undefined) patch.photoURL = photoURL
  await updateDoc(botDoc(botUid), patch)
  // Keep the mirror in step, since that's what the UI actually renders.
  const userPatch = {}
  if (patch.name) userPatch.name = patch.name
  if (photoURL !== undefined) userPatch.photoURL = photoURL
  if (Object.keys(userPatch).length) await updateDoc(doc(db, 'users', botUid), userPatch)
}

/**
 * Remove a bot entirely.
 *
 * Its Firebase Auth account is NOT deleted — that needs the Admin SDK, which
 * this app has no access to. Deleting the registry doc is what actually
 * revokes it: isBot() in firestore.rules fails without one, so the account
 * survives as an inert uid that can authenticate and then do nothing at all.
 * Messages it already posted keep their author, which is why the /users doc
 * is left in place too.
 */
export async function deleteBot(botUid) {
  await deleteDoc(botCredentialsDoc(botUid)).catch(() => {})
  await deleteDoc(botDoc(botUid))
}
