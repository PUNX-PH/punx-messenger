import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/group.dart';
import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../router/route_paths.dart';
import '../../services/image_service.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import 'create_group_screen.dart';
import 'group_context_sheet.dart';
import '../../widgets/shared/profile_sheet.dart';

/// Mobile equivalent of ServerRail.jsx — vertical list of groups instead of
/// a desktop icon rail (icon rail doesn't scale to a phone-width screen).
class GroupsListScreen extends ConsumerWidget {
  const GroupsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final groups = ref.watch(myGroupsProvider).valueOrNull ?? const [];
    // A guest cannot create a group — firestore.rules refuses it outright — so
    // don't offer it. Until `guest` was added to Role it parsed as `employee`,
    // which is why this was never noticed. Mirrors ServerRail.jsx.
    final isGuest =
        ref.watch(profileProvider).valueOrNull?.role.isGuest ?? false;

    return Scaffold(
      backgroundColor: Palette.bgDark,
      appBar: AppBar(
        title: const Text('Groups'),
        actions: const [ProfileAvatarButton()],
      ),
      body: groups.isEmpty
          ? Center(
              child: Text(
                isGuest
                    ? "You'll see the channels you were invited to here."
                    : 'No groups yet. Tap + to create one.',
                textAlign: TextAlign.center,
                style: AppTextStyles.sm(color: Palette.inkMuted),
              ),
            )
          : ListView.builder(
              itemCount: groups.length,
              itemBuilder: (context, index) => _GroupTile(group: groups[index]),
            ),
      floatingActionButton: isGuest
          ? null
          : FloatingActionButton(
              backgroundColor: Palette.ok,
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CreateGroupScreen()),
              ),
              child: const Icon(Icons.add, color: Colors.white),
            ),
    );
  }
}

class _GroupTile extends ConsumerWidget {
  const _GroupTile({required this.group});
  final Group group;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasUnread = ref.watch(groupHasUnreadProvider(group.id));

    return ListTile(
      onTap: () => context.push(RoutePaths.groupPath(group.id)),
      onLongPress: () => showGroupContextSheet(context, ref, group),
      leading: _GroupIcon(group: group),
      title: Text(
        group.name,
        style: AppTextStyles.sm(
          weight: hasUnread ? FontWeight.w700 : FontWeight.w400,
        ),
      ),
      trailing: hasUnread
          ? SizedBox(
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
    );
  }
}

class _GroupIcon extends StatelessWidget {
  const _GroupIcon({required this.group});
  final Group group;

  @override
  Widget build(BuildContext context) {
    final imageUrl = group.imageURL;
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadii.md),
      child: SizedBox(
        width: 40,
        height: 40,
        child: imageUrl != null && imageUrl.isNotEmpty
            ? Image.memory(
                ImageService.decodeDataUrl(imageUrl),
                fit: BoxFit.cover,
              )
            : ColoredBox(
                color: Palette.brand,
                child: Center(
                  child: Text(
                    group.name.isNotEmpty ? group.name[0].toUpperCase() : '?',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
      ),
    );
  }
}
