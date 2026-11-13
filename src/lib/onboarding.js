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
