// Muting one conversation (a DM or a single channel), as opposed to a whole group.
//
// A muted conversation is stored on the person's own profile as `mutedChats`: a list of the
// same read keys that `lastRead` uses (pathToReadKey of "dms/<id>" or
// "groups/<g>/channels/<c>"). It is quiet, not hidden or blocked: it stops counting towards
// the tab badge and the unread hotkeys, shows no unread dot, and a muted DM stops pinging.
// It still opens normally, and a channel @mention still notifies (as for a muted group).
// "Mark as read" still clears it. Pure, so it is tested.

/** The muted conversations of a profile, as a Set of read keys. Anything that is not a list of text is none. */
export function mutedChatsOf(profile) {
  const list = profile?.mutedChats
  return new Set(Array.isArray(list) ? list.filter((k) => typeof k === 'string' && k) : [])
}

/** The menu wording: "Mute channel" / "Unmute channel", "Mute conversation" / "Unmute conversation". */
export function muteLabel(muted, what) {
  return `${muted ? 'Unmute' : 'Mute'} ${what}`
}
