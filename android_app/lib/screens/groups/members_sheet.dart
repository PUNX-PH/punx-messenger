import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/group.dart';
import '../../models/user_profile.dart';
import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../providers/presence_providers.dart';
import '../../providers/users_providers.dart';
import '../../router/route_paths.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../widgets/shared/avatar.dart';

/// Right-side members panel on the web, a modal bottom sheet here — port of
/// components/MembersPanel.jsx: online/offline split, sorted owner > admin >
/// member, tap-to-DM on any non-self row.
void showMembersSheet(BuildContext context, String groupId) {
  showModalBottomSheet(
    context: context,
    backgroundColor: Palette.bgRaised,
    isScrollControlled: true,
    builder: (context) => _MembersSheet(groupId: groupId),
  );
}

class _MembersSheet extends ConsumerWidget {
  const _MembersSheet({required this.groupId});
  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final group = ref.watch(groupProvider(groupId)).valueOrNull;
    final usersById = ref.watch(usersByIdProvider);
    final me = ref.watch(profileProvider).valueOrNull;
    ref.watch(tickNowProvider); // keep online/offline split current over time

    if (group == null) {
      return const SizedBox(
        height: 160,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final members =
        group.memberUids
            .map((id) => usersById[id])
            .whereType<UserProfile>()
            .toList()
          ..sort((a, b) {
            int tier(UserProfile u) =>
                group.isOwner(u.id) ? 0 : (group.isAdmin(u.id) ? 1 : 2);
            final t = tier(a).compareTo(tier(b));
            return t != 0 ? t : a.name.compareTo(b.name);
          });

    final now = DateTime.now();
    final online = members
        .where((u) => computeStatus(u, now) != 'offline')
        .toList();
    final offline = members
        .where((u) => computeStatus(u, now) == 'offline')
        .toList();

    return SafeArea(
      child: DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (context, scrollController) {
          return ListView(
            controller: scrollController,
            padding: const EdgeInsets.all(12),
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                child: Text(
                  'Members — ${members.length}',
                  style: AppTextStyles.sm(weight: FontWeight.w700),
                ),
              ),
              if (members.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'No members yet.',
                    style: AppTextStyles.sm(color: Palette.inkMuted),
                  ),
                ),
              if (online.isNotEmpty) _SectionLabel('Online — ${online.length}'),
              for (final u in online)
                _MemberRow(user: u, group: group, meId: me?.id, dimmed: false),
              if (offline.isNotEmpty)
                _SectionLabel('Offline — ${offline.length}'),
              for (final u in offline)
                _MemberRow(user: u, group: group, meId: me?.id, dimmed: true),
            ],
          );
        },
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
      child: Text(
        text,
        style: AppTextStyles.xs(color: Palette.inkDim, weight: FontWeight.w600),
      ),
    );
  }
}

class _MemberRow extends ConsumerWidget {
  const _MemberRow({
    required this.user,
    required this.group,
    required this.meId,
    required this.dimmed,
  });
  final UserProfile user;
  final Group group;
  final String? meId;
  final bool dimmed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(statusOfProvider(user.id));
    return Opacity(
      opacity: dimmed ? 0.55 : 1.0,
      child: ListTile(
        leading: Avatar(
          name: user.name,
          src: user.photoURL,
          size: 28,
          status: status,
          ringColor: Palette.bgRaised,
        ),
        title: Text(
          user.name + (user.id == meId ? ' (you)' : ''),
          style: AppTextStyles.sm(),
        ),
        trailing: group.isOwner(user.id)
            ? Text('Owner', style: AppTextStyles.xs(color: Palette.warn))
            : group.isAdmin(user.id)
            ? Text('Admin', style: AppTextStyles.xs(color: Palette.brand))
            : null,
        onTap: user.id == meId
            ? null
            : () {
                Navigator.of(context).pop();
                context.push(RoutePaths.dmConvoPath(user.id));
              },
      ),
    );
  }
}
