// Asks the Worker (POST /onboarding/join-default-group, workers/src/routes/onboarding.js)
// to add the signed-in person to the default group, with their own ID token, the same way
// the GIF picker, the TURN credentials and the calendar do. The Worker decides; this only
// asks. Best effort: the caller does not wait for it and ignores a failure, because a missed
// attempt is retried at the next sign-in (see shouldJoinDefaultGroup).
import { auth } from './firebase'

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
