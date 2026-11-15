import '../models/user_profile.dart';

// Muting one conversation (a DM or a single channel), as opposed to a whole group: mirrors
// src/lib/muted.js, and stored in the same place (`mutedChats` on the person's own profile), so
// a mute made on the web holds on the phone and the other way round.
//
// A muted conversation is quiet, not hidden or blocked: it stops counting as unread (no dot, and
// it no longer lights up its group), and a muted DM stops pinging and notifying. It still opens
// normally, and an @mention in a channel still notifies (as for a muted group). Mark as read
// still clears it.

/// Has this person muted the conversation with this read key?
bool isChatMuted(UserProfile? profile, String readKey) =>
    profile != null && profile.mutedChats.contains(readKey);

/// The menu wording: "Mute channel" / "Unmute channel", "Mute conversation" / "Unmute conversation".
String muteLabel(bool muted, String what) => '${muted ? 'Unmute' : 'Mute'} $what';
