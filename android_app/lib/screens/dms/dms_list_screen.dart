import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/user_profile.dart';
import '../../providers/auth_providers.dart';
import '../../providers/dm_providers.dart';
import '../../providers/presence_providers.dart';
import '../../providers/users_providers.dart';
import '../../router/route_paths.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/firestore_paths.dart';
import '../../widgets/shared/avatar.dart';
import '../../widgets/shared/role_badge.dart';
import '../../widgets/shared/profile_sheet.dart';

/// Directory of teammates + pinned "My Notes" entry — port of
/// DMsSidebar.jsx/DMsHome.jsx, merged into one mobile list screen (there's
/// no separate "nothing selected" pane on a phone).
class DmsListScreen extends ConsumerStatefulWidget {
  const DmsListScreen({super.key});

  @override
  ConsumerState<DmsListScreen> createState() => _DmsListScreenState();
}

class _DmsListScreenState extends ConsumerState<DmsListScreen> {
  final _filterController = TextEditingController();
  String _filter = '';

  @override
  void dispose() {
    _filterController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(profileProvider).valueOrNull;
    // Active only: a removed teammate and a switched-off bot both drop out of
    // this list. An existing conversation with one stays openable by route,
    // and their messages keep their author.
    final allUsers = ref.watch(activeUsersProvider);
    final convosByOther = ref.watch(myDmConvosProvider).valueOrNull ?? const {};

    final teammates = allUsers.where((u) => u.id != profile?.id).toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    final f = _filter.trim().toLowerCase();
    final visible = f.isEmpty
        ? teammates
        : teammates
              .where(
                (u) =>
                    u.name.toLowerCase().contains(f) ||
                    u.email.toLowerCase().contains(f),
              )
              .toList();

    return Scaffold(
      backgroundColor: Palette.bgDark,
      appBar: AppBar(
        title: const Text('Direct Messages'),
        actions: const [ProfileAvatarButton()],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _filterController,
              onChanged: (v) => setState(() => _filter = v),
              style: AppTextStyles.sm(),
              decoration: InputDecoration(
                hintText: 'Search teammates',
                prefixIcon: const Icon(
                  Icons.search,
                  size: 18,
                  color: Palette.inkDim,
                ),
                fillColor: Palette.bgDeepest,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadii.md),
                  borderSide: BorderSide.none,
                ),
                isDense: true,
              ),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.edit_note, color: Palette.inkMuted),
            title: const Text('My Notes'),
            onTap: () => context.push(RoutePaths.myNotes),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'DIRECT MESSAGES — ${visible.length}',
                style: AppTextStyles.xs(
                  color: Palette.inkDim,
                  weight: FontWeight.w600,
                ),
              ),
            ),
          ),
          Expanded(
            child: teammates.isEmpty
                ? Center(
                    child: Text(
                      'No other teammates yet.',
                      style: AppTextStyles.sm(color: Palette.inkMuted),
                    ),
                  )
                : visible.isEmpty
                ? Center(
                    child: Text(
                      'No match.',
                      style: AppTextStyles.sm(color: Palette.inkMuted),
                    ),
                  )
                : ListView.builder(
                    itemCount: visible.length,
                    itemBuilder: (context, index) {
                      final u = visible[index];
                      final convo = convosByOther[u.id];
                      final unread =
                          profile != null &&
                          convo != null &&
                          isUnread(
                            convo.lastMessageAt,
                            profile.lastRead[pathToReadKey('dms/${convo.id}')],
                          );
                      return _DmRow(
                        user: u,
                        unread: unread,
                        onTap: () => context.push(RoutePaths.dmConvoPath(u.id)),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _DmRow extends ConsumerWidget {
  const _DmRow({required this.user, required this.unread, required this.onTap});
  final UserProfile user;
  final bool unread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(statusOfProvider(user.id));
    return ListTile(
      onTap: onTap,
      leading: Avatar(
        name: user.name,
        src: user.photoURL,
        size: 32,
        status: status,
        ringColor: Palette.bgDark,
      ),
      title: Row(
        children: [
          Flexible(
            child: Text(
              user.name,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.sm(
                weight: unread ? FontWeight.w700 : FontWeight.w400,
              ),
            ),
          ),
          const SizedBox(width: 6),
          RoleBadge(role: user.role, size: RoleBadgeSize.xs),
        ],
      ),
      trailing: unread ? const _UnreadDot() : null,
    );
  }
}

class _UnreadDot extends StatelessWidget {
  const _UnreadDot();
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: const BoxDecoration(
        color: Palette.bad,
        shape: BoxShape.circle,
      ),
    );
  }
}
