// When the app asks the Worker to put a new account into the default group (PUNX TEAM).
//
// The Worker is the one that decides (workers/src/routes/onboarding.js checks every one of
// these again: a client is not trusted). This only avoids a pointless request on every
// sign-in, and the constants below are the Worker's, pinned equal by tests/onboarding.test.mjs.

export const NEW_ACCOUNT_DAYS = 7
export const STAFF_ROLES = ['employee', 'admin', 'super_admin', 'developer']
const DAY_MS = 24 * 60 * 60 * 1000

const millis = (ts) => {
  if (ts?.toMillis) return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  return null
}

/** Exactly name@<domain>, in any letter case. A look-alike or longer domain is not the company's. */
export function hasCompanyEmail(email, domain) {
  const d = String(domain ?? '').trim().toLowerCase()
  const e = String(email ?? '').toLowerCase()
  const at = e.lastIndexOf('@')
  return !!d && at > 0 && e.slice(at + 1) === d
}

/**
 * Should this sign-in ask the Worker to add the person to the default group?
 *   - A company address (@punx.ai): an externally allowed one is not added.
 *   - Staff, not a guest.
 *   - Not already marked (the mark is what keeps someone who left from being put back).
 *   - New: the account was just created now, or was created in the last week. The week is
 *     what lets a first attempt that failed be retried at the next sign-in, while people who
 *     were here before this existed are never touched.
 */
export function shouldJoinDefaultGroup({ profile, email, domain, now = Date.now(), justCreated = false }) {
  if (!profile) return false
  if (!hasCompanyEmail(email, domain)) return false
  if (!STAFF_ROLES.includes(profile.role)) return false
  if (profile.defaultGroupJoinedAt) return false
  if (justCreated) return true
  const at = millis(profile.createdAt)
  return Number.isFinite(at) && at <= now + 5 * 60 * 1000 && now - at <= NEW_ACCOUNT_DAYS * DAY_MS
}

// ---------- the one-off job: everyone already here ----------
// The admin page's "Team group" card (src/components/TeamGroupAdmin.jsx) asks the Worker
// for a preview, then, once a person confirms, to do it. Who may: the Worker's
// BACKFILL_ROLES, pinned equal by tests/onboarding.test.mjs.

/** Roles that may add everyone already here to the default group. */
export const BACKFILL_ROLES = ['developer', 'super_admin']

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`

/** The preview, in a sentence: who would be added, and how many are in already. */
export function previewText({ toAdd = 0, alreadyIn = 0, groupName = 'the team group' } = {}) {
  if (!toAdd) return `Everyone is already in ${groupName}.`
  return `${people(toAdd)} would be added to ${groupName}${alreadyIn ? ` (${alreadyIn} already in)` : ''}.`
}

/** The names shown under the preview: the first few, then "and N more" for the rest. */
export function namesLine(names, total, shown = 20) {
  const list = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n) : []
  const count = Number.isFinite(total) ? Math.max(total, list.length) : list.length
  if (!list.length) return ''
  const head = list.slice(0, shown).join(', ')
  const more = count - Math.min(list.length, shown)
  return more > 0 ? `${head} and ${more} more` : head
}

/** What was done, in a sentence. */
export function resultText({ added = 0, groupName = 'the team group' } = {}) {
  return added ? `Added ${people(added)} to ${groupName}.` : `No one needed adding: everyone is already in ${groupName}.`
}

/** Plain words for a failed request, by the Worker's status (0: no answer at all). */
export function describeBackfillFailure(status) {
  if (status === 401 || status === 403) return "This isn't available to your account."
  if (status === 409) return "Couldn't find a single team group to add people to."
  if (status === 413) return 'There are too many accounts for this to run in one go.'
  if (status === 0) return "Couldn't reach the server. Check your connection and try again."
  return 'Something went wrong. Nothing was lost: trying again finishes whatever is left.'
}
