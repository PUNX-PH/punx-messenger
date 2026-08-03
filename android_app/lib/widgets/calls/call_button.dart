import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/calls_providers.dart';
import '../../theme/palette.dart';

/// Header actions that start a voice or video call with `otherUid`. Passed
/// into ChatSurface's `headerActions` slot only from DmChatScreen (v1 is
/// DM-only).
class CallButton extends ConsumerWidget {
  const CallButton({super.key, required this.otherUid});

  final String otherUid;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final callState = ref.watch(callControllerProvider);
    final controller = ref.read(callControllerProvider.notifier);
    final call = callState.call;
    final busy = call != null;
    final alreadyWithThem =
        call != null &&
        (call.callerUid == otherUid || call.calleeUid == otherUid);
    final busyReason = alreadyWithThem
        ? 'Already on a call with them'
        : busy
        ? 'You’re already on another call'
        : null;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          icon: const Icon(Icons.call_outlined),
          color: Palette.inkMuted,
          tooltip: busyReason ?? 'Start a voice call',
          onPressed: busy
              ? null
              : () => controller.startCall(otherUid, callType: 'audio'),
        ),
        IconButton(
          icon: const Icon(Icons.videocam_outlined),
          color: Palette.inkMuted,
          tooltip: busyReason ?? 'Start a video call',
          onPressed: busy
              ? null
              : () => controller.startCall(otherUid, callType: 'video'),
        ),
      ],
    );
  }
}
