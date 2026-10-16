import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/presence.dart';
import '../models/user_profile.dart';
import '../utils/constants.dart';

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
String computeStatus(UserProfile? user, DateTime now) =>
    computeStatusFromPresence(
      user == null
          ? null
          : Presence(presence: user.presence, lastSeen: user.lastSeen),
      now,
    );

/// The same rule, on a [Presence]. This is the one the app uses: the user objects
/// in the directory deliberately carry no presence (see users_identity.dart).
String computeStatusFromPresence(Presence? p, DateTime now) {
  if (p == null) return 'offline';
  final lastSeenMs = p.lastSeen?.millisecondsSinceEpoch ?? 0;
  final staleness = now.millisecondsSinceEpoch - lastSeenMs;
  if (staleness > AppTiming.offlineAfterMs) return 'offline';
  // Legacy 'idle' treated the same as 'away' for existing docs.
  if (p.presence == 'away' || p.presence == 'idle') return 'away';
  return 'online';
}

/// How often a changed presence map is published. Statuses are bucketed by
/// minutes (away after 5, offline after 2 without a heartbeat) and drawn from a
/// 30s tick, so a few seconds of lag is invisible, while ten people's heartbeats
/// collapse from a rebuild every few seconds into at most one every fifteen.
const presencePublishInterval = Duration(seconds: 15);

/// Everyone's presence, published on its own and in batches.
///
/// Every online person rewrites `lastSeen` every 45 seconds. Carried on the user
/// objects, each of those rebuilt every screen that reads the directory. Here, a
/// screen watches ONE person's presence (see [statusOfProvider]) and rebuilds only
/// when that person's changes.
class PresenceStore extends StateNotifier<Map<String, Presence>> {
  PresenceStore([this._interval = presencePublishInterval]) : super(const {});

  final Duration _interval;
  Timer? _timer;
  Map<String, Presence>? _pending;

  /// [immediate] for the first snapshot and for a change in WHO is in the
  /// directory — a rebuild is happening then anyway. Otherwise the newest map
  /// replaces any waiting one and goes out at the next flush.
  void publish(Map<String, Presence> next, {bool immediate = false}) {
    if (immediate) {
      _timer?.cancel();
      _timer = null;
      _pending = null;
      state = next;
      return;
    }
    _pending = next;
    _timer ??= Timer(_interval, () {
      _timer = null;
      final waiting = _pending;
      _pending = null;
      if (waiting != null && mounted) state = waiting;
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

final presenceStoreProvider =
    StateNotifierProvider<PresenceStore, Map<String, Presence>>(
      (ref) => PresenceStore(),
    );

/// Live presence status ('online' | 'away' | 'offline') for a given uid.
final statusOfProvider = Provider.family<String, String>((ref, uid) {
  ref.watch(tickNowProvider); // force periodic re-evaluation
  // Selected: this rebuilds when THIS person's presence changes, not anyone's.
  final p = ref.watch(presenceStoreProvider.select((m) => m[uid]));
  return computeStatusFromPresence(p, DateTime.now());
});
