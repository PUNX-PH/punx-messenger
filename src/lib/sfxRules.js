// WHEN each sound should play, as pure functions so the rules are tested without
// a browser. The player itself is src/lib/sfx.js; android_app/lib/services/
// sfx_rules.dart is the same rules for the Android app — keep them in step.

/**
 * Which sound a call's status change should make. Statuses come from useCall:
 * 'idle' | 'outgoing' | 'incoming' | 'connected'.
 *
 * @returns {{ stop: string[], play: string | null }} what to silence and what to
 * start for a move from status `prev` to `next`.
 */
export function callSoundActions(prev, next) {
  if (prev === next) return { stop: [], play: null }

  // Whatever was ringing stops on ANY change: answered, declined, cancelled,
  // missed, or the call simply vanishing.
  const stop = ['ring', 'ringback']

  if (next === 'incoming') return { stop, play: 'ring' }
  if (next === 'outgoing') return { stop, play: 'ringback' }
  if (next === 'connected') return { stop, play: 'call_connected' }

  // Back to idle. A call that was up, or one I placed that went nowhere
  // (declined, unanswered, cancelled), gets the "ended" sound. An incoming call
  // that stopped ringing — I declined it, or the caller gave up — does not:
  // it's already silent, and a chime there would read as "something happened".
  if (next === 'idle' && (prev === 'connected' || prev === 'outgoing')) {
    return { stop, play: 'call_ended' }
  }
  return { stop, play: null }
}

/**
 * Sounds for a voice-channel roster change, for people OTHER than me.
 *
 * `primed` is false for the roster's first snapshot after I join: it lists
 * everyone already here, which is not news, so it makes no sound. `deafened`
 * silences the room's comings and goings, because you asked not to hear it.
 *
 * @returns {string[]} zero, one or two sounds (a join and a leave can coincide).
 */
export function rosterSounds({ primed, deafened, myUid, added, removed }) {
  if (!primed || deafened) return []
  const out = []
  if (added.some(uid => uid !== myUid)) out.push('peer_join')
  if (removed.some(uid => uid !== myUid)) out.push('peer_leave')
  return out
}
