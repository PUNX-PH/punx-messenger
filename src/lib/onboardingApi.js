// Asks the Worker (POST /onboarding/join-default-group, workers/src/routes/onboarding.js)
// to add the signed-in person to the default group, with their own ID token, the same way
// the GIF picker, the TURN credentials and the calendar do. The Worker decides; this only
// asks. Best effort: the caller does not wait for it and ignores a failure, because a missed
// attempt is retried at the next sign-in (see shouldJoinDefaultGroup).
import { auth } from './firebase'
import { describeBackfillFailure } from './onboarding'

const WORKER_API_URL = import.meta.env.VITE_GIFS_WORKER_URL || 'http://127.0.0.1:8787'

export async function requestDefaultGroup() {
  const user = auth.currentUser
  if (!user) return null
  const res = await fetch(`${WORKER_API_URL}/onboarding/join-default-group`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  })
  if (!res.ok) throw new Error(`join-default-group answered ${res.status}`)
  return res.json()
}

// ---------- the one-off job: everyone already here ----------
// POST /onboarding/add-existing-members, with ?dry=1 for a preview that writes nothing. The
// Worker lets only a developer or a super admin through, and checks again who is asking.

async function postJob(path) {
  const user = auth.currentUser
  if (!user) throw new BackfillError(401)
  let res
  try {
    res = await fetch(`${WORKER_API_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    })
  } catch {
    throw new BackfillError(0)
  }
  if (!res.ok) throw new BackfillError(res.status)
  return res.json()
}

/** A failed job request, carrying the words to show. */
export class BackfillError extends Error {
  constructor(status) {
    super(describeBackfillFailure(status))
    this.status = status
  }
}

/** What would happen: { toAdd, alreadyIn, names, groupName, ... }. Writes nothing. */
export const previewExistingMembers = () => postJob('/onboarding/add-existing-members?dry=1')

/** Does it. */
export const addExistingMembers = () => postJob('/onboarding/add-existing-members')
