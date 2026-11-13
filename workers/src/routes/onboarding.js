import { verifyAuth } from '../auth.js'
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
