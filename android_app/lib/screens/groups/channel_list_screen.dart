import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/group.dart';
import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../router/route_paths.dart';
import '../../services/image_service.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/firestore_paths.dart';

/// Mobile equivalent of ChannelSidebar.jsx — the channel picker for a group.
/// Unlike the desktop app (where a persistent sidebar makes GroupHome.jsx a
/// pure "jump to #general" redirect), this is a real screen the user can
/// come back to via the system back button, so it stays a genuine list
/// rather than auto-redirecting into a channel every time.
class ChannelListScreen extends ConsumerWidget {
  const ChannelListScreen({super.key, required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final group = ref.watch(groupProvider(groupId)).valueOrNull;
    final channels =
        ref.watch(channelsProvider(groupId)).valueOrNull ?? const [];
    final profile = ref.watch(profileProvider).valueOrNull;
    final elevated =
        profile != null &&
        (profile.role.isAdmin ||
            (group?.adminUids.contains(profile.id) ?? false));

    return Scaffold(
      backgroundColor: Palette.bgDark,
      appBar: AppBar(title: Text(group?.name ?? 'Group')),
      body: Column(
        children: [
          if (group?.bannerURL != null) _GroupBanner(group: group!),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                Text(
                  'TEXT CHANNELS',
                  style: AppTextStyles.xs(
                    color: Palette.inkDim,
                    weight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                if (elevated)
                  IconButton(
                    icon: const Icon(
                      Icons.add,
                      size: 18,
                      color: Palette.inkMuted,
                    ),
                    onPressed: () => _createChannel(context, ref, profile.id),
                  ),
              ],
            ),
          ),
          Expanded(
            child: channels.isEmpty
                ? Center(
                    child: Text(
                      'No channels yet.',
                      style: AppTextStyles.sm(color: Palette.inkMuted),
                    ),
                  )
                : ListView.builder(
                    itemCount: channels.length,
                    itemBuilder: (context, index) {
                      final c = channels[index];
                      final unread =
                          profile != null &&
                          isUnread(
                            c.lastMessageAt,
                            profile.lastRead[pathToReadKey(
                              'groups/$groupId/channels/${c.id}',
                            )],
                          );
                      return ListTile(
                        // A private channel only reaches this list if the
                        // viewer is allowed it — GroupsRepository
                        // .listenChannels queries for exactly what the rules
                        // will serve — so the lock is a label, not a gate.
                        leading: c.private
                            ? const Icon(
                                Icons.lock_outline,
                                size: 16,
                                color: Palette.inkDim,
                              )
                            : Text(
                                '#',
                                style: AppTextStyles.base(
                                  color: Palette.inkDim,
                                ),
                              ),
                        title: Text(
                          c.name,
                          style: AppTextStyles.sm(
                            weight: unread ? FontWeight.w700 : FontWeight.w400,
                          ),
                        ),
                        trailing: unread
                            ? const SizedBox(
                                width: 8,
                                height: 8,
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    color: Palette.bad,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                              )
                            : null,
                        onTap: () =>
                            context.push(RoutePaths.channelPath(groupId, c.id)),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _createChannel(
    BuildContext context,
    WidgetRef ref,
    String createdBy,
  ) async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Palette.bgRaised,
        title: const Text('Create channel'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'new-channel'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    if (name == null || name.trim().isEmpty) return;
    final channelId = await ref
        .read(groupsRepositoryProvider)
        .createChannel(groupId, name: name, createdBy: createdBy);
    if (context.mounted) {
      context.push(RoutePaths.channelPath(groupId, channelId));
    }
  }
}

class _GroupBanner extends StatelessWidget {
  const _GroupBanner({required this.group});
  final Group group;

  @override
  Widget build(BuildContext context) {
    final bannerURL = group.bannerURL ?? '';
    if (bannerURL.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 72,
      width: double.infinity,
      child: Image.memory(
        ImageService.decodeDataUrl(bannerURL),
        fit: BoxFit.cover,
      ),
    );
  }
}
