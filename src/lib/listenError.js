// What to tell someone when a conversation could not be loaded.
//
// A Firestore listener that fails is finished: it never delivers data again. The
// chat used to ignore that, so it kept showing "This is the start of the
// conversation" over a channel that was full of messages. Saying what happened,
// and offering to try again where trying again can help, is the whole job here.

/**
 * @param {{ code?: string, message?: string }|null|undefined} err a Firestore error
 * @returns {{ message: string, retryable: boolean }}
 *   `retryable` is false when trying again cannot help (no access, missing setup).
 */
export function describeListenError(err) {
  const code = String(err?.code || '').replace(/^firestore\//, '')
  switch (code) {
    case 'permission-denied':
      return {
        message: "You don't have access to this conversation. If that's unexpected, ask an admin of the group.",
        retryable: false,
      }
    case 'failed-precondition':
      // Almost always a query that needs an index nobody created yet.
      return {
        message: "This conversation isn't set up to be shown yet (a required database index is missing). Tell an admin.",
        retryable: false,
      }
    case 'unavailable':
    case 'deadline-exceeded':
    case 'cancelled':
      return {
        message: "Couldn't reach the server. Check your connection and try again.",
        retryable: true,
      }
    default:
      return { message: "This conversation couldn't be loaded.", retryable: true }
  }
}
