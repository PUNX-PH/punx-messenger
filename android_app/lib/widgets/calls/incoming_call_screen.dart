import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/calls_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/palette.dart';
import '../shared/avatar.dart';

/// Full-screen ring/accept/decline UI shown to the callee. Rendered by
/// CallOverlay (mounted once in AppShell's Stack) so it appears regardless
/// of which bottom-nav tab is active.
class IncomingCallScreen extends ConsumerWidget {
  const IncomingCallScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final callState = ref.watch(callControllerProvider);
    final controller = ref.read(callControllerProvider.notifier);
    final call = callState.call;
    if (call == null) return const SizedBox.shrink();

    final caller = ref.watch(usersByIdProvider)[call.callerUid];

    return Material(
      color: Palette.bgDeepest,
      child: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Avatar(name: caller?.name ?? '?', src: caller?.photoURL, size: 88),
              const SizedBox(height: 16),
              Text(
                caller?.name ?? 'Someone',
                style: TextStyle(
                  color: Palette.ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Incoming ${call.type == 'audio' ? 'voice' : 'video'} call…',
                style: TextStyle(color: Palette.inkDim, fontSize: 14),
              ),
              const SizedBox(height: 32),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _RoundButton(
                    color: Palette.bad,
                    icon: Icons.call_end,
                    label: 'Decline',
                    onPressed: controller.decline,
                  ),
                  const SizedBox(width: 24),
                  _RoundButton(
                    color: Palette.ok,
                    icon: Icons.call,
                    label: 'Accept',
                    onPressed: controller.accept,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    required this.color,
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final Color color;
  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onPressed,
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Icon(icon, color: Colors.white, size: 28),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(label, style: TextStyle(color: Palette.inkMuted, fontSize: 12)),
      ],
    );
  }
}
