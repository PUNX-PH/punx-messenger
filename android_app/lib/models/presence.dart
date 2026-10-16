import 'package:cloud_firestore/cloud_firestore.dart';

/// When someone was last around: the two fields of a user document that change by
/// themselves (every online person rewrites `lastSeen` every 45 seconds).
///
/// Kept apart from [UserProfile] on purpose — see lib/services/users_identity.dart.
/// Compares by value, so a screen watching one person's presence rebuilds only
/// when THEIR presence changes, not when anyone else's does.
class Presence {
  const Presence({required this.presence, this.lastSeen});

  /// 'online' | 'away', or the legacy 'idle'.
  final String presence;
  final Timestamp? lastSeen;

  @override
  bool operator ==(Object other) =>
      other is Presence &&
      other.presence == presence &&
      other.lastSeen?.millisecondsSinceEpoch ==
          lastSeen?.millisecondsSinceEpoch;

  @override
  int get hashCode => Object.hash(presence, lastSeen?.millisecondsSinceEpoch);
}
