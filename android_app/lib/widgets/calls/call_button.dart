import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/calls_providers.dart';
import '../../theme/palette.dart';

/// Header action that starts a call with `otherUid`. Passed into
/// ChatSurface's `headerActions` slot only from DmChatScreen (v1 is DM-only).
class CallButton extends ConsumerWidget {
  const CallButton({super.key, required this.otherUid});

  final String otherUid;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final callState = ref.watch(callControllerProvider);
    final call = callState.call;
    final busy = call != null;
    final alreadyWithThem =
        call != null &&
        (call.callerUid == otherUid || call.calleeUid == otherUid);

    return IconButton(
      icon: const Icon(Icons.videocam_outlined),
      color: Palette.inkMuted,
      tooltip: alreadyWithThem
          ? 'Already on a call with them'
          : busy
          ? 'You’re already on another call'
          : 'Start a call',
      onPressed: busy
          ? null
          : () => ref.read(callControllerProvider.notifier).startCall(otherUid),
    );
  }
}
