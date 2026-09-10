import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/group.dart';
import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../router/route_paths.dart';
import '../../theme/palette.dart';
import 'group_settings_screen.dart';

/// Long-press context menu for a group row — port of ServerRail.jsx's
/// right-click/long-press menu (GroupContextMenu.jsx), as a bottom sheet.
void showGroupContextSheet(BuildContext context, WidgetRef ref, Group group) {
  final profile = ref.read(profileProvider).valueOrNull;
  if (profile == null) return;
  final muted = profile.mutedGroups.contains(group.id);
  final isOwner = group.ownerUid == profile.id;
  final repo = ref.read(groupsRepositoryProvider);

  showModalBottomSheet(
    context: context,
    backgroundColor: Palette.bgRaised,
    builder: (sheetContext) {
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(Icons.done_all, color: Palette.ink),
              title: const Text('Mark as read'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                repo.markGroupAsRead(
                  profile.id,
                  group.id,
                  // Without this it fetches the channels unfiltered, which
                  // the rules deny to anyone below admin.
                  viewer: ref.read(channelViewerProvider(group.id)),
                );
              },
            ),
            ListTile(
              leading: Icon(
                muted
                    ? Icons.notifications_off_outlined
                    : Icons.notifications_outlined,
                color: Palette.ink,
              ),
              title: Text(muted ? 'Unmute group' : 'Mute group'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                repo.toggleMuteGroup(profile.id, group.id, !muted);
              },
            ),
            ListTile(
              leading: Icon(Icons.settings_outlined, color: Palette.ink),
              title: const Text('Group settings'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => GroupSettingsScreen(groupId: group.id),
                  ),
                );
              },
            ),
            const Divider(height: 1),
            ListTile(
              leading: Icon(Icons.logout, color: Palette.bad),
              title: Text(
                isOwner
                    ? 'Leave group (transfer ownership first)'
                    : 'Leave group',
                style: TextStyle(color: isOwner ? Palette.inkDim : Palette.bad),
              ),
              enabled: !isOwner,
              onTap: isOwner
                  ? null
                  : () async {
                      Navigator.of(sheetContext).pop();
                      final confirmed = await showDialog<bool>(
                        context: context,
                        builder: (dialogContext) => AlertDialog(
                          backgroundColor: Palette.bgRaised,
                          title: Text('Leave ${group.name}?'),
                          actions: [
                            TextButton(
                              onPressed: () =>
                                  Navigator.of(dialogContext).pop(false),
                              child: const Text('Cancel'),
                            ),
                            TextButton(
                              onPressed: () =>
                                  Navigator.of(dialogContext).pop(true),
                              child: Text(
                                'Leave',
                                style: TextStyle(color: Palette.bad),
                              ),
                            ),
                          ],
                        ),
                      );
                      if (confirmed == true) {
                        await repo.leaveGroup(
                          group.id,
                          profile.id,
                          group.ownerUid,
                        );
                        if (context.mounted) context.go(RoutePaths.groups);
                      }
                    },
            ),
          ],
        ),
      );
    },
  );
}
