// firestore.rules test suite.
//
// Covers the role hierarchy (developer > super_admin > admin > employee >
// guest), super-admin oversight, the developer-group boundary, per-channel
// access, invite links, and the auth gate that keeps forged identities out.
//
// `@firebase/rules-unit-testing` is deliberately NOT a package.json dependency:
// it conflicts with the pinned firebase version and would break `npm ci`.
// Install it on demand instead.
//
//   npm i --no-save --legacy-peer-deps @firebase/rules-unit-testing
//   export PATH="/path/to/jdk/bin:$PATH"            # the emulator needs Java
//   npx firebase emulators:exec --only firestore --project punx-rules-test //     "node tests/rules.test.mjs"
//
// It runs entirely against the local emulator and never touches live data.
// Every `assertFails` here is load-bearing: two of them caught a real hole
// where an invitee could add somebody other than themselves.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where,
} from 'firebase/firestore'

const PROJECT = 'punx-rules-test'
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080').split(':')

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
})

// isHuman() pins provider + domain, so every human context carries both.
const as = (uid, email) => testEnv.authenticatedContext(uid, {
  email: email || `${uid}@punx.ai`,
  email_verified: true,
  firebase: { sign_in_provider: 'google.com', identities: {} },
}).firestore()

// An outsider: genuine Google sign-in, address outside the company. Should be
// able to do nothing at all until they redeem a live invite.
const outsider = (uid) => as(uid, `${uid}@gmail.com`)

// A password-provider account claiming an internal address — the bypass the
// google.com pin exists to prevent. createUserWithEmailAndPassword never
// verifies the address, so this identity is trivially forgeable.
const forged = (uid, email) => testEnv.authenticatedContext(uid, {
  email: email || `${uid}@punx.ai`,
  email_verified: false,
  firebase: { sign_in_provider: 'password', identities: {} },
}).firestore()

const DEV = 'devu', DEV2 = 'devtwo', SUPER = 'superu', ADMIN = 'adminu', EMP = 'empu', OUT = 'outu'
const REY = 'reyu'                       // super_admin holding the bootstrap email
const GUEST = 'guestu', GUEST2 = 'guesttwo'
const OUT1 = 'outsider1', OUT2 = 'outsider2', OUT3 = 'outsider3', OUT4 = 'outsider4'
const TOK_LIVE = 'tok-live', TOK_EXPIRED = 'tok-expired', TOK_REVOKED = 'tok-revoked'
const T1 = 't1', T2 = 't2', T3 = 't3'    // fresh promotion targets, one per test
const PLAIN = 'plainemp'                 // stays an employee for the whole suite
const GM = 'g-mine', GD = 'g-dev', GD2 = 'g-dev2'
const B1 = 'b1'

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  const u = (uid, role, email) =>
    setDoc(doc(db, 'users', uid), { uid, role, email: email || `${uid}@punx.ai`, name: uid })
  await u(DEV, 'developer'); await u(DEV2, 'developer')
  await u(SUPER, 'super_admin'); await u(REY, 'super_admin', 'rey@punx.ai')
  await u(ADMIN, 'admin'); await u(EMP, 'employee'); await u(OUT, 'employee')
  await u(T1, 'employee'); await u(T2, 'employee'); await u(T3, 'employee')
  await u(GUEST, 'guest'); await u(GUEST2, 'guest')
  await u(PLAIN, 'employee')

  // Normal group: no developer involved. Both guests are members of it.
  await setDoc(doc(db, 'groups', GM), {
    name: 'Mine', ownerUid: ADMIN, memberUids: [EMP, ADMIN, GUEST, GUEST2, T1], adminUids: [ADMIN],
  })
  // An ordinary public channel, carrying the two fields the backfill stamps.
  await setDoc(doc(db, 'groups', GM, 'channels', 'c1'), {
    name: 'general', type: 'text', private: false, allowUids: [],
  })
  await setDoc(doc(db, 'groups', GM, 'channels', 'c1', 'messages', 'm1'), { text: 'hi', author: { uid: EMP } })
  // A channel the backfill MISSED: no `private` key at all. The rules read
  // that field unguarded, so this one is denied rather than public — see the
  // section on it below, and channelIsPublic() in firestore.rules.
  await setDoc(doc(db, 'groups', GM, 'channels', 'cold'), { name: 'stale', type: 'text' })
  await setDoc(doc(db, 'groups', GM, 'channels', 'cold', 'messages', 'om1'), { text: 'old', author: { uid: EMP } })
  // Public channel the guest IS invited to.
  await setDoc(doc(db, 'groups', GM, 'channels', 'cg'), {
    name: 'tester', type: 'text', private: false, allowUids: [GUEST],
  })
  await setDoc(doc(db, 'groups', GM, 'channels', 'cg', 'messages', 'gm1'), { text: 'hey', author: { uid: EMP } })
  // Public channel the guest is NOT invited to.
  await setDoc(doc(db, 'groups', GM, 'channels', 'cx'), {
    name: 'offlimits', type: 'text', private: false, allowUids: [],
  })
  await setDoc(doc(db, 'groups', GM, 'channels', 'cx', 'messages', 'xm1'), { text: 'nope', author: { uid: EMP } })
  // Private channel: only T1 listed.
  await setDoc(doc(db, 'groups', GM, 'channels', 'cp'), {
    name: 'secretish', type: 'text', private: true, allowUids: [T1],
  })
  await setDoc(doc(db, 'groups', GM, 'channels', 'cp', 'messages', 'pm1'), { text: 'shh', author: { uid: T1 } })
  // Voice channels: one the guest is invited to, one it isn't.
  await setDoc(doc(db, 'groups', GM, 'channels', 'vg'), {
    name: 'guestvoice', type: 'voice', private: false, allowUids: [GUEST],
  })
  await setDoc(doc(db, 'groups', GM, 'channels', 'vx'), {
    name: 'novoice', type: 'voice', private: false, allowUids: [],
  })

  // Developer-owned group. EMP is also a member, to prove membership still works.
  await setDoc(doc(db, 'groups', GD), { name: 'Dev', ownerUid: DEV, memberUids: [DEV, EMP], adminUids: [DEV] })
  await setDoc(doc(db, 'groups', GD, 'categories', 'cat1'), { name: 'C', order: 0 })
  await setDoc(doc(db, 'groups', GD, 'channels', 'dc1'), {
    name: 'secret', type: 'text', private: false, allowUids: [],
  })
  await setDoc(doc(db, 'groups', GD, 'channels', 'dc1', 'messages', 'dm1'), { text: 'private', author: { uid: DEV } })
  await setDoc(doc(db, 'groups', GD, 'channels', 'dv1'), {
    name: 'devvoice', type: 'voice', private: false, allowUids: [],
  })
  await setDoc(doc(db, 'groups', GD, 'channels', 'dv1', 'voiceParticipants', DEV), { uid: DEV, lastHeartbeat: new Date() })

  // A second developer's group, to check developers can't watch each other.
  await setDoc(doc(db, 'groups', GD2), { name: 'Dev2', ownerUid: DEV2, memberUids: [DEV2], adminUids: [DEV2] })
  await setDoc(doc(db, 'groups', GD2, 'channels', 'd2c1'), {
    name: 'other', type: 'text', private: false, allowUids: [],
  })

  const hour = 60 * 60 * 1000
  const inv = (extra) => ({
    groupId: GM, groupName: 'Mine',
    channelIds: ['cg'], channelNames: ['tester'],
    createdBy: ADMIN, createdAt: new Date(), revoked: false,
    expiresAt: new Date(Date.now() + 24 * hour),
    ...extra,
  })
  await setDoc(doc(db, 'invites', TOK_LIVE), inv())
  await setDoc(doc(db, 'invites', TOK_EXPIRED), inv({ expiresAt: new Date(Date.now() - hour) }))
  await setDoc(doc(db, 'invites', TOK_REVOKED), inv({ revoked: true }))

  await setDoc(doc(db, 'bots', B1), { uid: B1, name: 'bot', enabled: true, scopes: [], commands: [] })
  await setDoc(doc(db, 'users', B1), { uid: B1, name: 'bot', role: 'employee', type: 'bot', email: null })
})

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); console.log('  PASS  ' + name); pass++ }
  catch (e) { console.log('  FAIL  ' + name + '\n          ' + String(e.message || e).split('\n')[0]); fail++ }
}
const chans = (db, g) => getDocs(collection(db, 'groups', g, 'channels'))
// The legs a client is allowed to run — see listenChannels in lib/groups.js.
// Nobody but an overseer may query this collection unfiltered any more.
const chansPublic = (db, g) =>
  getDocs(query(collection(db, 'groups', g, 'channels'), where('private', '==', false)))
const chansNaming = (db, g, uid) =>
  getDocs(query(collection(db, 'groups', g, 'channels'), where('allowUids', 'array-contains', uid)))
const chansPrivate = (db, g) =>
  getDocs(query(collection(db, 'groups', g, 'channels'), where('private', '==', true)))
const ids = (snap) => snap.docs.map(d => d.id)

console.log('\n-- baseline: existing behaviour unchanged --')
await t('member reads own group channels', () => assertSucceeds(chansPublic(as(EMP), GM)))
await t('member posts in own group', () => assertSucceeds(
  setDoc(doc(as(EMP), 'groups', GM, 'channels', 'c1', 'messages', 'n1'), { text: 'y', author: { uid: EMP } })))
await t('outsider CANNOT read a group', () => assertFails(chans(as(OUT), GM)))
await t('outsider CANNOT list all groups', () => assertFails(getDocs(collection(as(OUT), 'groups'))))
await t('group admin manages own group channels', () => assertSucceeds(
  setDoc(doc(as(ADMIN), 'groups', GM, 'channels', 'newc'), { name: 'x', type: 'text' })))

console.log('\n-- super-admin oversight still works on normal groups --')
await t('super admin lists every group', () => assertSucceeds(getDocs(collection(as(SUPER), 'groups'))))
await t('super admin reads a normal group it is not in', () => assertSucceeds(chans(as(SUPER), GM)))
await t('super admin reads normal-group messages', () => assertSucceeds(
  getDoc(doc(as(SUPER), 'groups', GM, 'channels', 'c1', 'messages', 'm1'))))
await t('super admin CANNOT post in a normal group it is not in', () => assertFails(
  setDoc(doc(as(SUPER), 'groups', GM, 'channels', 'c1', 'messages', 'g1'), { text: 'x', author: { uid: SUPER } })))

console.log('\n-- THE DEVELOPER BOUNDARY: super admin locked out of a developer group --')
await t('super admin CANNOT read developer-group channels', () => assertFails(chans(as(SUPER), GD)))
await t('super admin CANNOT read developer-group messages', () => assertFails(
  getDoc(doc(as(SUPER), 'groups', GD, 'channels', 'dc1', 'messages', 'dm1'))))
await t('super admin CANNOT read developer-group categories', () => assertFails(
  getDocs(collection(as(SUPER), 'groups', GD, 'categories'))))
await t('super admin CANNOT read developer-group voice roster', () => assertFails(
  getDocs(collection(as(SUPER), 'groups', GD, 'channels', 'dv1', 'voiceParticipants'))))
await t('super admin CANNOT add itself to a developer group', () => assertFails(
  updateDoc(doc(as(SUPER), 'groups', GD), { memberUids: [DEV, EMP, SUPER] })))
await t('super admin CANNOT delete a developer group', () => assertFails(deleteDoc(doc(as(SUPER), 'groups', GD))))
await t('super admin CANNOT create a channel in a developer group', () => assertFails(
  setDoc(doc(as(SUPER), 'groups', GD, 'channels', 'sneak'), { name: 's', type: 'text' })))
await t('plain admin CANNOT read developer-group channels either', () => assertFails(chans(as(ADMIN), GD)))
// Documented compromise, asserted so it stays deliberate: an unfiltered list
// query fails whole if any one doc is denied, so the group DOC stays readable.
await t('super admin CAN still read the developer group DOC (known compromise)', () => assertSucceeds(
  getDoc(doc(as(SUPER), 'groups', GD))))

console.log('\n-- membership is the only way in --')
await t('member of a developer group reads it normally', () => assertSucceeds(chansPublic(as(EMP), GD)))
await t('member of a developer group reads its messages', () => assertSucceeds(
  getDoc(doc(as(EMP), 'groups', GD, 'channels', 'dc1', 'messages', 'dm1'))))
await t('developer reads its own group', () => assertSucceeds(chans(as(DEV), GD)))
await t('developer manages its own group', () => assertSucceeds(
  setDoc(doc(as(DEV), 'groups', GD, 'channels', 'own'), { name: 'o', type: 'text' })))
await t('developer CANNOT read ANOTHER developer group', () => assertFails(chans(as(DEV), GD2)))

console.log('\n-- developer holds super-admin powers --')
await t('developer oversees a normal group it is not in', () => assertSucceeds(chans(as(DEV), GM)))
await t('developer lists every group', () => assertSucceeds(getDocs(collection(as(DEV), 'groups'))))
await t('developer manages channels in a normal group', () => assertSucceeds(
  setDoc(doc(as(DEV), 'groups', GM, 'channels', 'devmade'), { name: 'd', type: 'text' })))
await t('developer changes an ordinary role', () => assertSucceeds(
  updateDoc(doc(as(DEV), 'users', T1), { role: 'admin' })))
await t('developer manages bots', () => assertSucceeds(updateDoc(doc(as(DEV), 'bots', B1), { enabled: false })))

console.log('\n-- only developers may grant or revoke `developer` --')
await t('super admin CANNOT promote anyone to developer', () => assertFails(
  updateDoc(doc(as(SUPER), 'users', T2), { role: 'developer' })))
await t('super admin CANNOT demote a developer', () => assertFails(
  updateDoc(doc(as(SUPER), 'users', DEV), { role: 'employee' })))
await t('super admin CANNOT delete a developer account', () => assertFails(
  deleteDoc(doc(as(SUPER), 'users', DEV))))
await t('admin CANNOT promote to developer', () => assertFails(
  updateDoc(doc(as(ADMIN), 'users', T2), { role: 'developer' })))
await t('bootstrap account CAN create the first developer', () => assertSucceeds(
  updateDoc(doc(as(REY, 'rey@punx.ai'), 'users', T2), { role: 'developer' })))
await t('developer CAN promote to developer', () => assertSucceeds(
  updateDoc(doc(as(DEV), 'users', T3), { role: 'developer' })))
await t('developer CAN demote another developer', () => assertSucceeds(
  updateDoc(doc(as(DEV), 'users', T3), { role: 'employee' })))
await t('employee CANNOT change any role', () => assertFails(
  updateDoc(doc(as(EMP), 'users', T1), { role: 'admin' })))
await t('self-update of display fields still works', () => assertSucceeds(
  updateDoc(doc(as(EMP), 'users', EMP), { name: 'Renamed' })))
await t('employee still CANNOT self-promote', () => assertFails(
  updateDoc(doc(as(EMP), 'users', EMP), { role: 'super_admin' })))

console.log('\n-- bots --')
await t('developer creates a bot', () => assertSucceeds(
  setDoc(doc(as(DEV), 'bots', 'b2'), { uid: 'b2', name: 'b2', enabled: true, scopes: [], commands: [] })))
await t('developer CANNOT read bot credentials', () => assertFails(
  getDoc(doc(as(DEV), 'bots', B1, 'private', 'credentials'))))
await t('employee CANNOT create a bot', () => assertFails(
  setDoc(doc(as(EMP), 'bots', 'b9'), { uid: 'b9', name: 'b9', enabled: true, scopes: [], commands: [] })))
await t('super admin still manages bots', () => assertSucceeds(
  updateDoc(doc(as(SUPER), 'bots', B1), { enabled: true })))

console.log('\n-- a channel the backfill MISSED (no `private` key) --')
// The exact reverse of what this suite asserted before. `ch.private` is now
// read unguarded, because that error is the only thing refusing an unfiltered
// list — so a channel without the key is denied rather than assumed public.
// This is the whole reason scripts/backfill-channel-privacy.mjs has to run
// before these rules are deployed.
await t('member CANNOT read a channel with no `private` key', () => assertFails(
  getDoc(doc(as(EMP), 'groups', GM, 'channels', 'cold'))))
await t('member CANNOT read its messages', () => assertFails(
  getDoc(doc(as(EMP), 'groups', GM, 'channels', 'cold', 'messages', 'om1'))))
await t('member CANNOT post in it', () => assertFails(
  setDoc(doc(as(EMP), 'groups', GM, 'channels', 'cold', 'messages', 'bad3'), { text: 'k', author: { uid: EMP } })))
// An admin is deliberately still let in: adminOverGroup() is checked before
// ch.private, so whoever can re-run the backfill can still see what it missed.
await t('group admin CAN still read it, so a miss stays fixable', () => assertSucceeds(
  getDoc(doc(as(ADMIN), 'groups', GM, 'channels', 'cold'))))

console.log('\n-- a backfilled public channel behaves as before --')
await t('member reads a public channel doc', () => assertSucceeds(
  getDoc(doc(as(EMP), 'groups', GM, 'channels', 'c1'))))
await t('member reads its messages', () => assertSucceeds(
  getDoc(doc(as(EMP), 'groups', GM, 'channels', 'c1', 'messages', 'm1'))))
await t('member posts in it', () => assertSucceeds(
  setDoc(doc(as(EMP), 'groups', GM, 'channels', 'c1', 'messages', 'leg1'), { text: 'k', author: { uid: EMP } })))

console.log('\n-- GUESTS: only the channels naming them --')
await t('guest reads the channel it was invited to', () => assertSucceeds(
  getDoc(doc(as(GUEST), 'groups', GM, 'channels', 'cg'))))
await t('guest reads that channel messages', () => assertSucceeds(
  getDoc(doc(as(GUEST), 'groups', GM, 'channels', 'cg', 'messages', 'gm1'))))
await t('guest posts in that channel', () => assertSucceeds(
  setDoc(doc(as(GUEST), 'groups', GM, 'channels', 'cg', 'messages', 'gp1'), { text: 'hi', author: { uid: GUEST } })))
await t('guest CANNOT read a public channel it is not invited to', () => assertFails(
  getDoc(doc(as(GUEST), 'groups', GM, 'channels', 'cx'))))
await t('guest CANNOT read that channel messages', () => assertFails(
  getDoc(doc(as(GUEST), 'groups', GM, 'channels', 'cx', 'messages', 'xm1'))))
await t('guest CANNOT post there', () => assertFails(
  setDoc(doc(as(GUEST), 'groups', GM, 'channels', 'cx', 'messages', 'bad1'), { text: 'x', author: { uid: GUEST } })))
await t('guest CANNOT read a legacy channel (no allowUids at all)', () => assertFails(
  getDoc(doc(as(GUEST), 'groups', GM, 'channels', 'c1'))))
await t('guest CANNOT list channels unfiltered', () => assertFails(
  getDocs(collection(as(GUEST), 'groups', GM, 'channels'))))
await t('guest CAN list channels via allowUids array-contains', () => assertSucceeds(
  getDocs(query(collection(as(GUEST), 'groups', GM, 'channels'), where('allowUids', 'array-contains', GUEST)))))
await t('guest CANNOT create a group', () => assertFails(
  setDoc(doc(as(GUEST), 'groups', 'gnew'), {
    name: 'g', ownerUid: GUEST, memberUids: [GUEST], adminUids: [GUEST] })))
await t('guest joins voice in an invited channel', () => assertSucceeds(
  setDoc(doc(as(GUEST), 'groups', GM, 'channels', 'vg', 'voiceParticipants', GUEST),
    { uid: GUEST, lastHeartbeat: new Date() })))
await t('guest CANNOT join voice in a channel it is not invited to', () => assertFails(
  setDoc(doc(as(GUEST), 'groups', GM, 'channels', 'vx', 'voiceParticipants', GUEST),
    { uid: GUEST, lastHeartbeat: new Date() })))
await t("one guest is not covered by another guest's invite", () => assertFails(
  getDoc(doc(as(GUEST2), 'groups', GM, 'channels', 'cg'))))

console.log('\n-- PRIVATE channels --')
await t('listed member reads private-channel messages', () => assertSucceeds(
  getDoc(doc(as(T1), 'groups', GM, 'channels', 'cp', 'messages', 'pm1'))))
await t('listed member posts in a private channel', () => assertSucceeds(
  setDoc(doc(as(T1), 'groups', GM, 'channels', 'cp', 'messages', 'tp1'), { text: 'y', author: { uid: T1 } })))
await t('unlisted member CANNOT read private-channel messages', () => assertFails(
  getDoc(doc(as(EMP), 'groups', GM, 'channels', 'cp', 'messages', 'pm1'))))
await t('unlisted member CANNOT post in a private channel', () => assertFails(
  setDoc(doc(as(EMP), 'groups', GM, 'channels', 'cp', 'messages', 'bad2'), { text: 'x', author: { uid: EMP } })))
await t('group admin reads private-channel messages', () => assertSucceeds(
  getDoc(doc(as(ADMIN), 'groups', GM, 'channels', 'cp', 'messages', 'pm1'))))
// Closing this was the point of the change: the channel's NAME used to be
// fetchable by any group member even though its contents were not.
await t('unlisted member CANNOT read the private channel DOC', () => assertFails(
  getDoc(doc(as(EMP), 'groups', GM, 'channels', 'cp'))))
await t('listed member CAN read the private channel DOC', () => assertSucceeds(
  getDoc(doc(as(T1), 'groups', GM, 'channels', 'cp'))))
await t('group admin CAN read the private channel DOC', () => assertSucceeds(
  getDoc(doc(as(ADMIN), 'groups', GM, 'channels', 'cp'))))

// … which costs the unfiltered query, since the rule is evaluated against the
// QUERY and an unfiltered one leaves `private` unknown. Each leg below pins
// enough for the rules to prove it safe.
await t('member CANNOT list channels unfiltered any more', () => assertFails(
  chans(as(EMP), GM)))
await t('member CAN list public channels', () => assertSucceeds(chansPublic(as(EMP), GM)))
await t('member CAN list channels naming them', () => assertSucceeds(chansNaming(as(EMP), GM, EMP)))
await t('member CANNOT list the private ones', () => assertFails(chansPrivate(as(EMP), GM)))
await t('the allowUids leg is how a listed member gets a private channel', async () => {
  const snap = await assertSucceeds(chansNaming(as(T1), GM, T1))
  if (!ids(snap).includes('cp')) throw new Error('cp missing from the allowUids leg')
})
await t('group admin CAN list the private ones', () => assertSucceeds(chansPrivate(as(ADMIN), GM)))
await t('super admin oversight still lists channels unfiltered', () => assertSucceeds(
  chans(as(SUPER), GM)))

// The legs return exactly what the caller may read, and nothing else — a
// private channel does not slip into the public leg, and a channel the
// backfill missed matches no leg at all (Firestore skips documents missing the
// field, so it is invisible on top of being denied).
await t('the public leg excludes private and un-backfilled channels', async () => {
  const got = ids(await assertSucceeds(chansPublic(as(EMP), GM)))
  if (got.includes('cp')) throw new Error('private channel matched `private == false`')
  if (got.includes('cold')) throw new Error('keyless channel matched `private == false`')
  if (!got.includes('c1')) throw new Error('public channel missing from its own leg')
})

console.log('\n-- the auth gate: forged identities get nothing --')
await t('password-provider account claiming @punx.ai CANNOT read the directory', () => assertFails(
  getDoc(doc(forged('forger1'), 'users', EMP))))
await t('password-provider account CANNOT create itself as employee', () => assertFails(
  setDoc(doc(forged('forger2'), 'users', 'forger2'), {
    uid: 'forger2', email: 'forger2@punx.ai', role: 'employee' })))
await t('password-provider account CANNOT redeem an invite either', () => assertFails(
  setDoc(doc(forged('forger3'), 'users', 'forger3'), {
    uid: 'forger3', email: 'forger3@punx.ai', role: 'guest', invitedVia: TOK_LIVE })))
await t('outsider with no invite CANNOT create a users doc', () => assertFails(
  setDoc(doc(outsider(OUT1), 'users', OUT1), { uid: OUT1, email: 'x@gmail.com', role: 'employee' })))
await t('outsider CANNOT create itself as guest without a token', () => assertFails(
  setDoc(doc(outsider(OUT1), 'users', OUT1), { uid: OUT1, email: 'x@gmail.com', role: 'guest' })))
await t('outsider CANNOT read a group', () => assertFails(getDoc(doc(outsider(OUT1), 'groups', GM))))

console.log('\n-- invite documents --')
await t('outsider CAN read an invite by token', () => assertSucceeds(
  getDoc(doc(outsider(OUT1), 'invites', TOK_LIVE))))
await t('nobody can LIST invites (no enumeration)', () => assertFails(
  getDocs(collection(outsider(OUT1), 'invites'))))
await t('group admin creates an invite', () => assertSucceeds(
  setDoc(doc(as(ADMIN), 'invites', 'tok-new'), {
    groupId: GM, groupName: 'Mine', channelIds: ['cg'], channelNames: ['tester'],
    createdBy: ADMIN, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000), revoked: false })))
await t('employee CANNOT create an invite', () => assertFails(
  setDoc(doc(as(EMP), 'invites', 'tok-bad'), {
    groupId: GM, groupName: 'Mine', channelIds: ['cg'], channelNames: ['tester'],
    createdBy: EMP, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000), revoked: false })))
await t('admin revokes an invite', () => assertSucceeds(
  updateDoc(doc(as(ADMIN), 'invites', 'tok-new'), { revoked: true })))
await t('admin CANNOT repoint an invite at other channels', () => assertFails(
  updateDoc(doc(as(ADMIN), 'invites', TOK_LIVE), { channelIds: ['cg', 'cx', 'cp'] })))
await t('admin CANNOT repoint an invite at another group', () => assertFails(
  updateDoc(doc(as(ADMIN), 'invites', TOK_LIVE), { groupId: GD })))
await t('outsider CANNOT revoke an invite', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'invites', TOK_LIVE), { revoked: true })))

console.log('\n-- redeeming a live invite --')
await t('outsider creates its guest doc with a live token', () => assertSucceeds(
  setDoc(doc(outsider(OUT1), 'users', OUT1), {
    uid: OUT1, email: `${OUT1}@gmail.com`, name: 'Out One', role: 'guest', invitedVia: TOK_LIVE })))
await t('...and CANNOT claim a higher role with the same token', () => assertFails(
  setDoc(doc(outsider(OUT2), 'users', OUT2), {
    uid: OUT2, email: `${OUT2}@gmail.com`, role: 'employee', invitedVia: TOK_LIVE })))
await t('...and CANNOT self-promote afterwards', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'users', OUT1), { role: 'admin' })))
await t('redemption marker is writable by the joiner', () => assertSucceeds(
  setDoc(doc(outsider(OUT1), 'invites', TOK_LIVE, 'redemptions', OUT1), {
    uid: OUT1, redeemedAt: new Date() })))
await t('joiner CANNOT write a redemption marker for someone else', () => assertFails(
  setDoc(doc(outsider(OUT1), 'invites', TOK_LIVE, 'redemptions', OUT2), {
    uid: OUT2, redeemedAt: new Date() })))
// Regression: redeemInvite used to getDoc() the group to build the new member
// array, which is denied for exactly the people invites exist for. The client
// must use arrayUnion and never read first.
await t('invitee CANNOT read the group doc before joining', () => assertFails(
  getDoc(doc(outsider(OUT1), 'groups', GM))))
await t('invitee CANNOT read a channel doc before joining', () => assertFails(
  getDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cg'))))
await t('invitee adds ONLY itself to the group', () => assertSucceeds(
  updateDoc(doc(outsider(OUT1), 'groups', GM), {
    memberUids: [EMP, ADMIN, GUEST, GUEST2, T1, OUT1] })))
await t('invitee CANNOT add anyone else alongside itself', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'groups', GM), {
    memberUids: [EMP, ADMIN, GUEST, GUEST2, T1, OUT1, OUT3] })))
await t('invitee CANNOT remove existing members while joining', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'groups', GM), { memberUids: [OUT1] })))
await t('invitee CANNOT make itself a group admin', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'groups', GM), { adminUids: [ADMIN, OUT1] })))
await t('invitee grants itself the invited channel', () => assertSucceeds(
  updateDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cg'), { allowUids: [GUEST, OUT1] })))
await t('invitee CANNOT grant itself a channel the invite omits', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cx'), { allowUids: [OUT1] })))
await t('invitee CANNOT grant itself a PRIVATE channel the invite omits', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cp'), { allowUids: [T1, OUT1] })))
await t('invitee CANNOT grant a third party the invited channel', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cg'), { allowUids: [GUEST, OUT1, OUT3] })))
await t('redeemed guest reads its invited channel', () => assertSucceeds(
  getDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cg'))))
await t('redeemed guest CANNOT read a channel it was not invited to', () => assertFails(
  getDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cx'))))
await t('redeemed guest posts in its invited channel', () => assertSucceeds(
  setDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cg', 'messages', 'om1'), {
    text: 'hello', author: { uid: OUT1 } })))
await t('redeemed guest CANNOT create a group', () => assertFails(
  setDoc(doc(outsider(OUT1), 'groups', 'gnew2'), {
    name: 'g', ownerUid: OUT1, memberUids: [OUT1], adminUids: [OUT1] })))

console.log('\n-- redeeming twice is a no-op, not a failure --')
// The client uses arrayUnion and cannot read the document first, so
// re-opening a link must not hard-fail. OUT1 is already in both lists here.
await t('re-joining the group with an unchanged member list succeeds', () => assertSucceeds(
  updateDoc(doc(outsider(OUT1), 'groups', GM), {
    memberUids: [EMP, ADMIN, GUEST, GUEST2, T1, OUT1] })))
await t('re-granting an already-granted channel succeeds', () => assertSucceeds(
  updateDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cg'), { allowUids: [GUEST, OUT1] })))
await t('a no-op write still cannot smuggle someone else in', () => assertFails(
  updateDoc(doc(outsider(OUT1), 'groups', GM, 'channels', 'cg'), { allowUids: [GUEST, OUT1, OUT3] })))

console.log('\n-- expired and revoked invites are inert --')
await t('expired token CANNOT create a guest doc', () => assertFails(
  setDoc(doc(outsider(OUT3), 'users', OUT3), {
    uid: OUT3, email: `${OUT3}@gmail.com`, role: 'guest', invitedVia: TOK_EXPIRED })))
await t('revoked token CANNOT create a guest doc', () => assertFails(
  setDoc(doc(outsider(OUT4), 'users', OUT4), {
    uid: OUT4, email: `${OUT4}@gmail.com`, role: 'guest', invitedVia: TOK_REVOKED })))
await t('unknown token CANNOT create a guest doc', () => assertFails(
  setDoc(doc(outsider(OUT4), 'users', OUT4), {
    uid: OUT4, email: `${OUT4}@gmail.com`, role: 'guest', invitedVia: 'no-such-token' })))

console.log('\n-- existing members keep their role when using a link --')
await t('an employee can stamp invitedVia on its own doc', () => assertSucceeds(
  updateDoc(doc(as(PLAIN), 'users', PLAIN), { invitedVia: TOK_LIVE })))
await t('...and still cannot change its own role', () => assertFails(
  updateDoc(doc(as(PLAIN), 'users', PLAIN), { role: 'admin' })))

console.log('\n-- staff sign-in is untouched --')
await t('internal user creates its own employee doc', () => assertSucceeds(
  setDoc(doc(as('newstaff'), 'users', 'newstaff'), {
    uid: 'newstaff', email: 'newstaff@punx.ai', name: 'New', role: 'employee' })))
await t('internal user CANNOT create itself as admin', () => assertFails(
  setDoc(doc(as('newstaff2'), 'users', 'newstaff2'), {
    uid: 'newstaff2', email: 'newstaff2@punx.ai', role: 'admin' })))
await t('bootstrap email may create itself as super_admin', () => assertSucceeds(
  setDoc(doc(as('reyfresh', 'rey@punx.ai'), 'users', 'reyfresh'), {
    uid: 'reyfresh', email: 'rey@punx.ai', role: 'super_admin' })))

console.log(`\n${pass} passed, ${fail} failed`)
await testEnv.cleanup()
process.exit(fail ? 1 : 0)
