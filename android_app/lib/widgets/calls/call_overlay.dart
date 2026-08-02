import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/calls_providers.dart';
import 'active_call_view.dart';
import 'incoming_call_screen.dart';

/// Always-mounted (sibling of PresenceHeartbeat/NotificationDaemon in
/// AppShell's Stack) so a call survives switching bottom-nav tabs. Renders
/// nothing when idle.
class CallOverlay extends ConsumerWidget {
  const CallOverlay({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(callControllerProvider.select((s) => s.status));
    return switch (status) {
      CallStatus.idle => const SizedBox.shrink(),
      CallStatus.incoming => const IncomingCallScreen(),
      CallStatus.outgoing || CallStatus.connected => const ActiveCallView(),
    };
  }
}
