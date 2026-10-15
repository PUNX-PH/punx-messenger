import '../providers/calls_providers.dart' show CallStatus;
import 'sfx_service.dart';

// WHEN each sound should play, as pure functions so the rules are tested without
// a phone. The player is sfx_service.dart; src/lib/sfxRules.js is the same rules
// for the web app — keep them in step.

/// Which sound a call's status change should make.
({List<Sfx> stop, Sfx? play}) callSoundActions(
  CallStatus prev,
  CallStatus next,
) {
  if (prev == next) return (stop: const [], play: null);

  // Whatever was ringing stops on ANY change: answered, declined, cancelled,
  // missed, or the call simply vanishing.
  const stop = [Sfx.ring, Sfx.ringback];

  switch (next) {
    case CallStatus.incoming:
      return (stop: stop, play: Sfx.ring);
    case CallStatus.outgoing:
      return (stop: stop, play: Sfx.ringback);
    case CallStatus.connected:
      return (stop: stop, play: Sfx.callConnected);
    case CallStatus.idle:
      // A call that was up, or one I placed that went nowhere, ends audibly. An
      // incoming call that stopped ringing — I declined it, or the caller gave
      // up — does not: it is already silent, and a chime would read as news.
      final audible =
          prev == CallStatus.connected || prev == CallStatus.outgoing;
      return (stop: stop, play: audible ? Sfx.callEnded : null);
  }
}

/// Sounds for a voice-channel roster change, for people OTHER than me.
///
/// [primed] is false for the roster's first snapshot after I join: it lists
/// everyone already here, which is not news, so it makes no sound. [deafened]
/// silences the room's comings and goings, because you asked not to hear it.
List<Sfx> rosterSounds({
  required bool primed,
  required bool deafened,
  required String myUid,
  required Iterable<String> added,
  required Iterable<String> removed,
}) {
  if (!primed || deafened) return const [];
  return [
    if (added.any((uid) => uid != myUid)) Sfx.peerJoin,
    if (removed.any((uid) => uid != myUid)) Sfx.peerLeave,
  ];
}

/// Whether a DM document update should ping.
///
/// [lastPingedStamp] is the message timestamp already pinged for this
/// conversation. A DM document is rewritten for reasons that are not a new
/// message (a typing indicator, a read receipt), and each rewrite re-delivers
/// the same last message; without this it would ping every time.
bool dmPingDue({
  required int? lastPingedStamp,
  required int stamp,
  required bool appInFront,
  required bool viewingThisConversation,
}) {
  if (lastPingedStamp == stamp) return false; // already told you about this one
  // In the background the system notification announces it, with its own sound.
  if (!appInFront) return false;
  // Already on screen: pinging for the thing you are reading is noise.
  return !viewingThisConversation;
}
