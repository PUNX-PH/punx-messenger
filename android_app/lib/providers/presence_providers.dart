import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/user_profile.dart';
import '../utils/constants.dart';
import 'users_providers.dart';

/// Re-ticks every [AppTiming.presenceTickMs] purely so dependent providers
/// re-evaluate staleness over time without a new Firestore write — mirrors
/// presence.jsx's PresenceTickProvider.
final tickNowProvider = StreamProvider<DateTime>((ref) {
  return Stream.periodic(
    const Duration(milliseconds: AppTiming.presenceTickMs),
    (_) => DateTime.now(),
  );
});

/// 1:1 port of presence.jsx's computeStatus().
String computeStatus(UserProfile? user, DateTime now) {
  if (user == null) return 'offline';
  final lastSeenMs = user.lastSeen?.millisecondsSinceEpoch ?? 0;
  final staleness = now.millisecondsSinceEpoch - lastSeenMs;
  if (staleness > AppTiming.offlineAfterMs) return 'offline';
  // Legacy 'idle' treated the same as 'away' for existing docs.
  if (user.presence == 'away' || user.presence == 'idle') return 'away';
  return 'online';
}

/// Live presence status ('online' | 'away' | 'offline') for a given uid.
final statusOfProvider = Provider.family<String, String>((ref, uid) {
  ref.watch(tickNowProvider); // force periodic re-evaluation
  final user = ref.watch(usersByIdProvider)[uid];
  return computeStatus(user, DateTime.now());
});
