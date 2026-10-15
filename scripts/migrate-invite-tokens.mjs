/**
 * One-time cleanup: remove invite tokens from the user directory.
 *
 * WHAT WAS WRONG. Redeeming an invite used to record the token on the person's
 * own users/{uid} document as `invitedVia`. That collection is readable by every
 * signed-in account, and the token IS the secret — so anyone could read someone
 * else's, copy it onto their own record, and join the group and channels that
 * invite grants. The rules and clients now keep it in users/{uid}/private/invite,
 * which nothing can read. This script deals with the tokens already sitting in
 * old documents.
 *
 * TWO SEPARATE THINGS, because they are not the same risk:
 *
 *   --apply            Delete the `invitedVia` field from every user document.
 *                      Safe. Nobody needs it: it was only ever used while joining,
 *                      and everyone who has joined has already joined.
 *
 *   --revoke-exposed   ALSO mark the invites those tokens belong to as revoked.
 *                      Deleting the field does NOT un-leak a token someone already
 *                      copied, and these tokens were readable by every signed-in
 *                      account for as long as they were stored. Revoking is the
 *                      only thing that closes that — but it also kills the link for
 *                      anyone you still meant to send it to, so it is opt-in.
 *                      Create a fresh link afterwards.
 *
 * Without --apply nothing is written. The dry run lists every invite whose token
 * was exposed, whether it is still live, and what it grants, which is what you
 * need to decide on --revoke-exposed.
 *
 * ─── Running it ──────────────────────────────────────────────────────────────
 *
 *   1. Firebase Console → Project settings → Service accounts →
 *      "Generate new private key". Save the JSON somewhere OUTSIDE this repo.
 *   2. npm i --no-save firebase-admin
 *   3. Dry run first:
 *
 *        GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *          node scripts/migrate-invite-tokens.mjs
 *
 *   4. Then add --apply, and --revoke-exposed if you want the links closed.
 *
 *   No key? GOOGLE_APPLICATION_CREDENTIALS may instead point at an
 *   `authorized_user` file (a signed-in person's refresh token, e.g. built from the
 *   Firebase CLI login, with "quota_project_id" set to the project). The script
 *   then acts as that person, who needs Firestore access. Keep such a file outside
 *   the repo and delete it afterwards.
 *
 * Deploy the new firestore.rules and clients FIRST, or this script races a
 * redemption that is still writing the old shape. Re-running it is free: a second
 * pass finds nothing, and the VERIFY line at the end should read 0.
 *
 * Set FIRESTORE_EMULATOR_HOST to point it at the local emulator instead (no key
 * needed) — that is how it is tested.
 */
import { readFileSync } from 'node:fs'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const REVOKE = process.argv.includes('--revoke-exposed')
const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST

if (REVOKE && !APPLY) {
  console.error('--revoke-exposed only makes sense with --apply. Run the dry run first to see what it would close.')
  process.exit(1)
}

let projectId
if (EMULATOR) {
  projectId = process.env.GCLOUD_PROJECT || 'demo-punx'
  initializeApp({ projectId })
} else if (KEY) {
  const creds = JSON.parse(readFileSync(KEY, 'utf8'))
  if (creds.type === 'authorized_user') {
    // A signed-in person's credential (an `authorized_user` file, e.g. built from
    // the Firebase CLI login) rather than a service-account key. It acts as that
    // person, so they need Firestore access to the project.
    projectId = process.env.GCLOUD_PROJECT || creds.quota_project_id
    if (!projectId) {
      console.error('That credential names no project. Add "quota_project_id" to it, or set GCLOUD_PROJECT.')
      process.exit(1)
    }
    initializeApp({ credential: applicationDefault(), projectId })
  } else {
    projectId = creds.project_id
    initializeApp({ credential: cert(creds), projectId })
  }
} else {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON. See the header of this file.')
  process.exit(1)
}
const db = getFirestore()

console.log(`project: ${projectId}${EMULATOR ? ` (emulator ${EMULATOR})` : ''}`)
console.log(APPLY ? `mode:    APPLY${REVOKE ? ' + REVOKE EXPOSED' : ''} (writing)\n` : 'mode:    DRY RUN (nothing will be written)\n')

// A write batch caps out at 500 operations.
const BATCH_LIMIT = 400

const users = await db.collection('users').get()
const holders = users.docs.filter(d => 'invitedVia' in d.data())

// token -> who is holding a copy of it
const byToken = new Map()
for (const d of holders) {
  const token = d.data().invitedVia
  const key = typeof token === 'string' ? token : `(not a string: ${JSON.stringify(token)})`
  if (!byToken.has(key)) byToken.set(key, [])
  byToken.get(key).push(d.id)
}

console.log(`${users.size} user documents scanned; ${holders.length} carry an invitedVia field`)
console.log(`${byToken.size} distinct invite token(s) were exposed in the directory:\n`)

const exposed = []
for (const [token, uids] of byToken) {
  const invite = typeof token === 'string' && /^[A-Za-z0-9_-]+$/.test(token)
    ? await db.doc(`invites/${token}`).get()
    : null
  if (!invite?.exists) {
    console.log(`  ${token.slice(0, 10)}…  held by ${uids.length}  — no such invite (already deleted); nothing to revoke`)
    continue
  }
  const inv = invite.data()
  const expiresMs = inv.expiresAt?.toMillis?.() ?? new Date(inv.expiresAt).getTime()
  const live = !inv.revoked && Number.isFinite(expiresMs) && expiresMs > Date.now()
  exposed.push({ token, live, ref: invite.ref })
  console.log(
    `  ${token.slice(0, 10)}…  held by ${uids.length}  — ${live ? 'LIVE' : inv.revoked ? 'already revoked' : 'expired'}`
    + `  → ${inv.groupName || inv.groupId}, channels: ${(inv.channelNames || []).join(', ') || '(none)'}`,
  )
}

const stillLive = exposed.filter(e => e.live)
console.log(`\n${stillLive.length} of those are still LIVE and were readable by every signed-in account.`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written.')
  console.log('  --apply              deletes the field from the user documents')
  console.log('  --apply --revoke-exposed   also revokes the live invites listed above')
  process.exit(0)
}

// ── 1. delete the field ─────────────────────────────────────────────────────
for (let i = 0; i < holders.length; i += BATCH_LIMIT) {
  const batch = db.batch()
  for (const d of holders.slice(i, i + BATCH_LIMIT)) batch.update(d.ref, { invitedVia: FieldValue.delete() })
  await batch.commit()
}
console.log(`\nremoved invitedVia from ${holders.length} user documents`)

// ── 2. optionally close the exposed links ───────────────────────────────────
if (REVOKE) {
  for (const { ref } of stillLive) await ref.update({ revoked: true })
  console.log(`revoked ${stillLive.length} live invite(s) — create fresh links for anyone still waiting`)
} else if (stillLive.length) {
  console.log(`\nNOT revoked: ${stillLive.length} live invite(s) whose tokens were world-readable. Re-run with`)
  console.log('--apply --revoke-exposed to close them (and create new links afterwards).')
}

// Verify by re-reading rather than trusting the writes.
const after = await db.collection('users').get()
const remaining = after.docs.filter(d => 'invitedVia' in d.data()).length
console.log(`\nVERIFY: ${remaining} user documents still carry invitedVia`)
if (remaining) {
  console.log('Something wrote the old shape after the scan — is an old client still deployed? Re-run once it is gone.')
  process.exit(1)
}
console.log('Directory is clean.')
