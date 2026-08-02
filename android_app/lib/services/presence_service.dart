import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/auth_providers.dart';
import '../utils/constants.dart';

/// Writes presence + lastSeen for the signed-in user — port of
/// presence.jsx's PresenceHeartbeat. No UI; mount once inside the
/// authenticated shell.
///
/// The web version also tracks fine-grained in-tab activity (mousemove,
/// keydown, scroll) to demote 'online' -> 'away' after 5 minutes of
/// inactivity *while the tab stays open*. A phone app doesn't have an
/// equivalent low-cost signal short of instrumenting every touch across the
/// whole widget tree, so this uses the foreground/background app lifecycle
/// as the activity signal instead: resumed -> online (heartbeat every
/// [AppTiming.heartbeatMs]), anything else -> away immediately. `offline` is
/// still computed purely client-side from lastSeen staleness
/// (see presence_providers.dart's computeStatus), unchanged from the web app.
class PresenceHeartbeat extends ConsumerStatefulWidget {
  const PresenceHeartbeat({super.key});

  @override
  ConsumerState<PresenceHeartbeat> createState() => _PresenceHeartbeatState();
}

class _PresenceHeartbeatState extends ConsumerState<PresenceHeartbeat>
    with WidgetsBindingObserver {
  Timer? _heartbeatTimer;
  String? _uid;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _heartbeatTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _goOnline();
    } else {
      _goAway();
    }
  }

  void _goOnline() {
    _writePresence('online');
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(
      const Duration(milliseconds: AppTiming.heartbeatMs),
      (_) => _writeLastSeenOnly(),
    );
  }

  void _goAway() {
    _heartbeatTimer?.cancel();
    _writePresence('away');
  }

  Future<void> _writePresence(String presence) async {
    final uid = _uid;
    if (uid == null) return;
    try {
      await FirebaseFirestore.instance.collection('users').doc(uid).update({
        'presence': presence,
        'lastSeen': FieldValue.serverTimestamp(),
      });
    } catch (_) {
      // non-fatal, matches presence.jsx
    }
  }

  Future<void> _writeLastSeenOnly() async {
    final uid = _uid;
    if (uid == null) return;
    try {
      await FirebaseFirestore.instance.collection('users').doc(uid).update({
        'lastSeen': FieldValue.serverTimestamp(),
      });
    } catch (_) {
      // non-fatal
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = ref.watch(profileProvider).valueOrNull?.id;
    if (uid != _uid) {
      _uid = uid;
      if (uid != null) _goOnline();
    }
    return const SizedBox.shrink();
  }
}
