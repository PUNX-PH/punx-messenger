import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/groups_providers.dart';
import '../../widgets/shared/loading_view.dart';
import 'channel_chat_screen.dart';
import 'voice_channel_screen.dart';

/// Decides which screen a channel opens into, from its `type`.
///
/// The route used to go straight to [ChannelChatScreen], so a voice channel
/// opened as an empty text chat with a composer — which is exactly what it
/// looked like to the user. Mirrors the same branch in the web's Channel.jsx.
class ChannelScreen extends ConsumerWidget {
  const ChannelScreen({
    super.key,
    required this.groupId,
    required this.channelId,
  });

  final String groupId;
  final String channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channel = ref
        .watch(channelProvider((groupId: groupId, channelId: channelId)))
        .valueOrNull;

    // Fail towards the chat screen while the document is in flight: it is the
    // overwhelmingly common case, and it loads its own copy anyway. Flashing
    // the voice room at someone opening a text channel would be worse than the
    // reverse.
    if (channel == null) {
      return const LoadingView(label: 'Loading channel');
    }

    if (channel.type == 'voice') {
      return VoiceChannelScreen(
        groupId: groupId,
        channelId: channelId,
        channelName: channel.name,
      );
    }
    return ChannelChatScreen(groupId: groupId, channelId: channelId);
  }
}
