import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/voice_channel_providers.dart';
import '../../router/route_paths.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// The "you are still connected" row, port of `VoiceStatusBar.jsx`.
///
/// Mounted in the shell rather than in the voice room, because the whole point
/// is that it survives navigating away: on a phone you join a channel and then
/// go read a DM, and without this there is no mute button and no way back
/// short of finding the channel again. It also has to keep rendering when a
/// join FAILS — the web once hid the bar whenever nothing was connected, which
/// destroyed the very banner explaining why the join didn't work.
class VoiceStatusBar extends ConsumerWidget {
  const VoiceStatusBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voice = ref.watch(voiceControllerProvider);
    final controller = ref.read(voiceControllerProvider.notifier);
    final active = voice.active;

    if (active == null && voice.connError == null) {
      return const SizedBox.shrink();
    }

    if (active == null) {
      // Error with nothing connected — see the note above.
      return Material(
        color: Palette.bad.withValues(alpha: 0.12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Icon(Icons.error_outline, size: 16, color: Palette.bad),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  voice.connError!,
                  style: AppTextStyles.xs(color: Palette.bad),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Material(
      color: Palette.bgRaised,
      child: InkWell(
        onTap: () => context.go(
          RoutePaths.channelPath(active.groupId, active.channelId),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(
            children: [
              Icon(Icons.graphic_eq, size: 16, color: Palette.ok),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Voice connected',
                      style: AppTextStyles.xs(color: Palette.ok),
                    ),
                    Text(
                      active.channelName,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.sm(),
                    ),
                  ],
                ),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: Icon(
                  voice.muted ? Icons.mic_off : Icons.mic,
                  size: 20,
                  color: voice.muted ? Palette.bad : Palette.ink,
                ),
                tooltip: voice.muted ? 'Unmute' : 'Mute',
                onPressed: controller.toggleMute,
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: Icon(
                  voice.deafened ? Icons.headset_off : Icons.headset,
                  size: 20,
                  color: voice.deafened ? Palette.bad : Palette.ink,
                ),
                tooltip: 'Deafen',
                onPressed: controller.toggleDeafen,
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: Icon(Icons.call_end, size: 20, color: Palette.bad),
                tooltip: 'Disconnect',
                onPressed: controller.leave,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
