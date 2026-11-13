import { AuthError, verifyAuth } from '../auth.js'
import { documentName, firestoreCommit, firestoreGet, firestoreQuery, loadServiceAccount } from '../googleAuth.js'

// A new account is added to the workspace's main group (PUNX TEAM) automatically.
//
// Why a Worker route: a person cannot add themselves to a group. The rules let an
// admin, an invite, or a member-managing bot change `memberUids`, and nobody else
// (firestore.rules, groups update). The Worker holds the project's service account,
// so it does the one write the rules would refuse, and only after checking that the
// caller is who the write is for.
//
// What it does, and what it deliberately does not:
//   - Adds ONLY the caller (the uid in their verified ID token; the request carries no
//     body) to the default group's `memberUids`, atomically, with an array union, so two
//     people joining at once cannot overwrite each other's entry.
//   - Marks the caller's profile (`defaultGroupJoinedAt`) in the same commit. That mark
//     is what keeps a person who later leaves the group from being put back.
//   - Only for NEW accounts: a profile made in the last NEW_ACCOUNT_DAYS days. People who
//     were here before this existed are not touched, and the window is what lets a first
//     attempt that failed (offline, Worker down) be retried at the next sign-in.
//   - Never for guests (invited into single channels and nothing else), never for a
//     removed account.
//   - Which group: DEFAULT_GROUP_ID if set, otherwise the one group named
//     DEFAULT_GROUP_NAME (compared ignoring case). Two groups with that name, or an owner
//     who is not a workspace admin, means NOTHING is joined: a look-alike group made by
//     an ordinary member must never be where new people land.
//
// Public channels follow group membership (channelVisible in firestore.rules), so
// being in `memberUids` is all a new person needs to see them. Private channels stay
// private.

export const NEW_ACCOUNT_DAYS = 7
const NEW_ACCOUNT_MS = NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000

/** Roles that sign in as staff. A guest is invited into specific channels instead. */
export const STAFF_ROLES = ['employee', 'admin', 'super_admin', 'developer']

/** Roles whose group is trusted as THE default group when it is found by name. */
const TRUSTED_OWNER_ROLES = ['admin', 'super_admin', 'developer']

const norm = (s) => String(s ?? '').trim().toLowerCase()

/** Was this profile created in the last NEW_ACCOUNT_DAYS days? (`createdAt` as Firestore returns it: an ISO string.) */
export function isNewAccount(createdAt, now = Date.now()) {
  const at = Date.parse(createdAt)
  return Number.isFinite(at) && at <= now + 5 * 60 * 1000 && now - at <= NEW_ACCOUNT_MS
}

/** The default group, or null (and a log line saying why) when there is no safe answer. */
export async function findDefaultGroup(env, sa) {
  if (env.DEFAULT_GROUP_ID) {
    const g = await firestoreGet(env, sa, `groups/${env.DEFAULT_GROUP_ID}`)
    return g ? { id: env.DEFAULT_GROUP_ID, ...g } : null
  }
  const wanted = norm(env.DEFAULT_GROUP_NAME)
  if (!wanted) return null
  // A workspace has a handful of groups; reading them all keeps the comparison
  // case-insensitive, which a Firestore equality filter is not.
  const groups = await firestoreQuery(env, sa, { from: [{ collectionId: 'groups' }], limit: 200 })
  const matches = groups.filter((g) => norm(g.name) === wanted)
  if (matches.length !== 1) {
    console.error(`[onboarding] ${matches.length} groups are named "${env.DEFAULT_GROUP_NAME}"; joining none`)
    return null
  }
  const owner = matches[0].ownerUid ? await firestoreGet(env, sa, `users/${matches[0].ownerUid}`) : null
  if (!owner || !TRUSTED_OWNER_ROLES.includes(owner.role)) {
    console.error(`[onboarding] "${env.DEFAULT_GROUP_NAME}" is not owned by a workspace admin; joining none`)
    return null
  }
  return matches[0]
}

const done = (reason, extra = {}) => Response.json({ joined: false, reason, ...extra })

/**
 * Is this a company address: exactly `name@punx.ai` (the configured domain)? The email is
 * the lower-cased one from the verified ID token. A longer domain that merely ends the
 * same way (`name@notpunx.ai`, `name@sub.punx.ai`) is not the company's, and neither is
 * one of the few external addresses the workspace also lets in.
 */
export function hasCompanyEmail(email, env) {
  const domain = String(env.ALLOWED_EMAIL_DOMAIN || 'punx.ai').trim().toLowerCase()
  const e = String(email ?? '').toLowerCase()
  const at = e.lastIndexOf('@')
  return at > 0 && e.slice(at + 1) === domain
}

/** POST /onboarding/join-default-group */
export async function joinDefaultGroup(request, env) {
  const caller = await verifyAuth(request, env)
  // Company accounts only. An externally allowed address signs in as staff too, but is
  // not put into the team group by this route.
  if (!hasCompanyEmail(caller.email, env)) return done('not-company-email')
  const sa = loadServiceAccount(env)

  const profile = await firestoreGet(env, sa, `users/${caller.uid}`)
  if (!profile) return done('no-profile')
  if (profile.deactivated === true) return done('removed')
  if (!STAFF_ROLES.includes(profile.role)) return done('not-staff')
  if (profile.defaultGroupJoinedAt) return done('already')
  if (!isNewAccount(profile.createdAt)) return done('not-new')

  const group = await findDefaultGroup(env, sa)
  if (!group) return done('no-default-group')

  // One atomic commit: the member list gains the caller (a union, so an existing entry
  // is left alone and a concurrent join is not overwritten), and their profile is marked.
  await firestoreCommit(env, sa, [
    {
      transform: {
        document: documentName(env, `groups/${group.id}`),
        fieldTransforms: [{
          fieldPath: 'memberUids',
          appendMissingElements: { values: [{ stringValue: caller.uid }] },
        }],
      },
    },
    {
      update: {
        name: documentName(env, `users/${caller.uid}`),
        fields: { defaultGroupJoinedAt: { timestampValue: new Date().toISOString() } },
      },
      updateMask: { fieldPaths: ['defaultGroupJoinedAt'] },
      currentDocument: { exists: true },
    },
  ])
  return Response.json({ joined: true, groupId: group.id })
}

// ---------------------------------------------------------------------------------------
// The one-off job: put everyone who is ALREADY here into the default group.
//
// joinDefaultGroup above is for new accounts. People who signed up before it existed are
// not touched by it (it only looks at the last week), so this does them, once, when a
// developer or super admin asks for it from the admin page:
//
//   POST /onboarding/add-existing-members?dry=1   what WOULD happen: counts and names, nothing written
//   POST /onboarding/add-existing-members         do it
//
// The same rules as for a new account decide who qualifies (a company address, staff and
// not a guest, not removed, not already stamped), plus: never a bot. Everyone it adds is
// stamped with defaultGroupJoinedAt, exactly as a new account is, so a person who later
// leaves the group is not put back by running it again. It is safe to run twice: members
// already in are left alone (an array union) and stamped people are skipped.
//
// It first adds all of them to the group, then stamps their profiles, in chunks (Firestore
// limits one commit's size). Each commit is atomic; the whole job is not, so if it stops
// part-way, run it again: what was done stays done and the rest is finished.
// ---------------------------------------------------------------------------------------

/** Who may run it. A plain admin cannot; this changes who is in a group workspace-wide. */
export const BACKFILL_ROLES = ['developer', 'super_admin']

const USER_READ_LIMIT = 2000 // more accounts than this and the job refuses rather than do part of it
const ADD_CHUNK = 400 // uids appended per commit
const STAMP_CHUNK = 200 // profiles stamped per commit
const PREVIEW_NAMES = 200 // names shown in the preview

/**
 * Sorts every account into "would be added" or a named reason it is left alone. Pure.
 * `users` are the profile documents ({ id, ...fields }); `memberUids` the group's current members.
 */
export function classifyMembers(users, memberUids, env) {
  const inGroup = new Set(Array.isArray(memberUids) ? memberUids : [])
  const skipped = { bots: 0, removed: 0, external: 0, guests: 0, otherRoles: 0, alreadyStamped: 0 }
  const eligible = [] // everyone who qualifies, in the group or not
  for (const u of users) {
    if (u.type === 'bot') { skipped.bots++; continue }
    if (u.deactivated === true) { skipped.removed++; continue }
    if (!hasCompanyEmail(u.email, env)) { skipped.external++; continue }
    if (u.role === 'guest') { skipped.guests++; continue }
    if (!STAFF_ROLES.includes(u.role)) { skipped.otherRoles++; continue }
    if (u.defaultGroupJoinedAt) { skipped.alreadyStamped++; continue }
    eligible.push({ uid: u.id, name: typeof u.name === 'string' ? u.name : '', inGroup: inGroup.has(u.id) })
  }
  return {
    eligible,
    toAdd: eligible.filter((e) => !e.inGroup),
    alreadyIn: eligible.filter((e) => e.inGroup),
    skipped,
  }
}

const chunks = (list, size) => {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** POST /onboarding/add-existing-members[?dry=1] */
export async function addExistingMembers(request, env) {
  const caller = await verifyAuth(request, env)
  if (!hasCompanyEmail(caller.email, env)) throw new AuthError('Not available to this account', 403)
  const sa = loadServiceAccount(env)

  // Who is asking, read fresh from the profile (never from a token claim), so removing a
  // role takes effect at once.
  const me = await firestoreGet(env, sa, `users/${caller.uid}`)
  if (!me || me.deactivated === true || !BACKFILL_ROLES.includes(me.role)) {
    throw new AuthError('Not available to this account', 403)
  }

  const group = await findDefaultGroup(env, sa)
  if (!group) throw new AuthError('No single default group was found (see docs/ONBOARDING.md)', 409)

  const users = await firestoreQuery(env, sa, { from: [{ collectionId: 'users' }], limit: USER_READ_LIMIT })
  if (users.length >= USER_READ_LIMIT) {
    throw new AuthError(`More than ${USER_READ_LIMIT} accounts: this job will not run part of them`, 413)
  }

  const { eligible, toAdd, alreadyIn, skipped } = classifyMembers(users, group.memberUids, env)
  const summary = {
    groupId: group.id,
    groupName: group.name ?? '',
    eligible: eligible.length,
    toAdd: toAdd.length,
    alreadyIn: alreadyIn.length,
    skipped,
  }

  if (new URL(request.url).searchParams.get('dry') === '1') {
    return Response.json({ dryRun: true, ...summary, names: toAdd.slice(0, PREVIEW_NAMES).map((e) => e.name || '(no name)') })
  }

  // 1. Everyone into the group (an array union: those already in stay as they are).
  for (const part of chunks(toAdd, ADD_CHUNK)) {
    await firestoreCommit(env, sa, [{
      transform: {
        document: documentName(env, `groups/${group.id}`),
        fieldTransforms: [{
          fieldPath: 'memberUids',
          appendMissingElements: { values: part.map((e) => ({ stringValue: e.uid })) },
        }],
      },
    }])
  }
  // 2. Stamp every account that qualified, in or not, so a person who later leaves is not
  // put back by running this again. The profile must still exist (a deleted one is not
  // recreated as an empty document).
  const stamp = new Date().toISOString()
  for (const part of chunks(eligible, STAMP_CHUNK)) {
    await firestoreCommit(env, sa, part.map((e) => ({
      update: {
        name: documentName(env, `users/${e.uid}`),
        fields: { defaultGroupJoinedAt: { timestampValue: stamp } },
      },
      updateMask: { fieldPaths: ['defaultGroupJoinedAt'] },
      currentDocument: { exists: true },
    })))
  }

  console.log(`[onboarding] ${caller.uid} added ${toAdd.length} existing member(s) to ${group.id}; stamped ${eligible.length}`)
  return Response.json({ dryRun: false, ...summary, added: toAdd.length, stamped: eligible.length })
}
