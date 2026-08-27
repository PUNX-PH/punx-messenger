/**
 * One-time backfill: stamp `private` and `allowUids` onto every channel that
 * predates them.
 *
 * WHY THIS IS NOT OPTIONAL. firestore.rules reads `ch.private` UNGUARDED, and
 * that is deliberate: an unfiltered channel query is refused only because that
 * read errors when no filter pinned the field. The cost of the lock is that a
 * channel document with no `private` key errors on an ordinary read too, so it
 * is denied rather than treated as public. Any channel this script misses
 * disappears for everyone below admin. Run it BEFORE deploying the rules.
 *
 * It writes `private: false` and `allowUids: []` and nothing else, and never
 * overwrites a field that already exists — a channel someone has already made
 * private stays private.
 *
 * ─── Running it ──────────────────────────────────────────────────────────────
 *
 *   1. Firebase Console → Project settings → Service accounts →
 *      "Generate new private key". Save the JSON somewhere OUTSIDE this repo.
 *   2. npm i --no-save firebase-admin
 *   3. Dry run first — reads only, writes nothing:
 *
 *        GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *          node scripts/backfill-channel-privacy.mjs
 *
 *   4. Then, with the same command plus --apply, actually write.
 *
 * Re-running it is free: a second pass finds nothing to do. Do exactly that
 * after any bulk import, and read the VERIFY line at the end — it counts what
 * is still missing the key, and it should say 0.
 *
 * The admin SDK bypasses security rules, which is the point: it reaches
 * developer-owned groups that no human account can see into.
 */
import { readFileSync } from 'node:fs'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!KEY) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON. See the header of this file.')
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(KEY, 'utf8'))
initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
const db = getFirestore()

console.log(`project: ${serviceAccount.project_id}`)
console.log(APPLY ? 'mode:    APPLY (writing)\n' : 'mode:    DRY RUN (nothing will be written)\n')

// A write batch caps out at 500 operations.
const BATCH_LIMIT = 400

const groups = await db.collection('groups').get()
let scanned = 0
let patched = 0
const pending = []

const flush = async () => {
  if (!pending.length) return
  if (APPLY) {
    const batch = db.batch()
    for (const { ref, update } of pending) batch.update(ref, update)
    await batch.commit()
  }
  pending.length = 0
}

for (const group of groups.docs) {
  const channels = await group.ref.collection('channels').get()
  const touched = []

  for (const channel of channels.docs) {
    scanned++
    const data = channel.data()
    const update = {}
    // Only ever fills a gap. An existing `private: true` is left alone, and so
    // is a populated allowUids — this must not quietly reopen a private
    // channel or drop somebody's access.
    if (typeof data.private !== 'boolean') update.private = false
    if (!Array.isArray(data.allowUids)) update.allowUids = []
    if (!Object.keys(update).length) continue

    patched++
    touched.push(`${channel.id} (${data.name || 'unnamed'}) ← ${JSON.stringify(update)}`)
    pending.push({ ref: channel.ref, update })
    if (pending.length >= BATCH_LIMIT) await flush()
  }

  if (touched.length) {
    console.log(`${group.id} — ${group.data().name || 'unnamed'} (${channels.size} channels)`)
    for (const line of touched) console.log(`    ${line}`)
  }
}
await flush()

console.log(`\nscanned ${scanned} channels in ${groups.size} groups; ${patched} needed a field`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. Re-run with --apply to write.')
  process.exit(0)
}

// Verify by re-reading rather than trusting the writes: this number is the one
// that decides whether the rules are safe to deploy.
let missing = 0
for (const group of groups.docs) {
  const channels = await group.ref.collection('channels').get()
  for (const channel of channels.docs) {
    const data = channel.data()
    if (typeof data.private !== 'boolean' || !Array.isArray(data.allowUids)) {
      missing++
      console.log(`  STILL MISSING: groups/${group.id}/channels/${channel.id}`)
    }
  }
}

console.log(`\nVERIFY: ${missing} channels still missing a field`)
if (missing) {
  console.log('Do NOT deploy firestore.rules until this reads 0 — those channels would be denied to every non-admin.')
  process.exit(1)
}
console.log('Safe to deploy firestore.rules.')
