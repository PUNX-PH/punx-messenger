import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../widgets/chat/chat_surface.dart';
import '../../widgets/shared/loading_view.dart';
import 'members_sheet.dart';

/// Wraps the shared chat surface against
/// `groups/{groupId}/channels/{channelId}/messages` — port of Channel.jsx.
class ChannelChatScreen extends ConsumerWidget {
  const ChannelChatScreen({
    super.key,
    required this.groupId,
    required this.channelId,
  });

  final String groupId;
  final String channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).valueOrNull;
    final group = ref.watch(groupProvider(groupId)).valueOrNull;
    final channelDoc = ref
        .watch(_channelNameProvider(ChannelKey(groupId, channelId)))
        .valueOrNull;

    if (profile == null || channelDoc == null) {
      return const LoadingView(label: 'Loading channel');
    }

    final elevated =
        profile.role.isAdmin ||
        (group?.adminUids.contains(profile.id) ?? false);

    return ChatSurface(
      title: channelDoc,
      icon: '#',
      path: 'groups/$groupId/channels/$channelId/messages',
      composerPlaceholder: 'Message #$channelDoc',
      canDeleteAny: elevated,
      canPin: elevated,
      emptyTitle: 'Welcome to #$channelDoc',
      emptyDesc:
          'This is the start of the channel. Drop a message to get the conversation going.',
      headerActions: [
        IconButton(
          icon: const Icon(Icons.people_outline),
          tooltip: 'Members',
          onPressed: () => showMembersSheet(context, groupId),
        ),
      ],
    );
  }
}

class ChannelKey {
  final String groupId;
  final String channelId;
  const ChannelKey(this.groupId, this.channelId);

  @override
  bool operator ==(Object other) =>
      other is ChannelKey &&
      other.groupId == groupId &&
      other.channelId == channelId;
  @override
  int get hashCode => Object.hash(groupId, channelId);
}

/// Channel name only — channel docs are otherwise covered by
/// [channelsProvider] (Phase 5); this is a lightweight standalone lookup so
/// the chat screen doesn't need the whole channel list loaded first.
final _channelNameProvider = StreamProvider.family<String?, ChannelKey>((
  ref,
  key,
) {
  return FirebaseFirestore.instance
      .collection('groups')
      .doc(key.groupId)
      .collection('channels')
      .doc(key.channelId)
      .snapshots()
      .map((snap) => snap.data()?['name'] as String?);
});
