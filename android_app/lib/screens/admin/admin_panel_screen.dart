import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/role.dart';
import '../../models/user_profile.dart';
import '../../providers/auth_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../widgets/shared/avatar.dart';
import '../../widgets/shared/role_badge.dart';

/// Super-admin-only role management screen — port of AdminPanel.jsx. The
/// route guard (app_router.dart) already keeps non-super-admins out.
class AdminPanelScreen extends ConsumerStatefulWidget {
  const AdminPanelScreen({super.key});

  @override
  ConsumerState<AdminPanelScreen> createState() => _AdminPanelScreenState();
}

class _AdminPanelScreenState extends ConsumerState<AdminPanelScreen> {
  final _filterController = TextEditingController();
  String _filter = '';
  String? _busyUid;
  String? _error;

  @override
  void dispose() {
    _filterController.dispose();
    super.dispose();
  }

  Future<void> _onChangeRole(UserProfile u, Role role, String myId) async {
    if (u.id == myId && role != Role.superAdmin) {
      setState(
        () => _error =
            "You can't demote yourself. Promote someone else first, then ask them to demote you.",
      );
      return;
    }
    setState(() {
      _busyUid = u.id;
      _error = null;
    });
    try {
      await ref.read(usersRepositoryProvider).setUserRole(u.id, role);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busyUid = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(profileProvider).valueOrNull;
    final users = ref.watch(usersStreamProvider).valueOrNull ?? const [];

    final counts = {Role.superAdmin: 0, Role.admin: 0, Role.employee: 0};
    for (final u in users) {
      counts[u.role] = (counts[u.role] ?? 0) + 1;
    }

    final f = _filter.trim().toLowerCase();
    final visible = f.isEmpty
        ? users
        : users
              .where(
                (u) =>
                    u.name.toLowerCase().contains(f) ||
                    u.email.toLowerCase().contains(f),
              )
              .toList();

    return Scaffold(
      backgroundColor: Palette.bgMain,
      appBar: AppBar(title: const Text('Admin panel')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: _Stat(
                    label: 'Super admins',
                    value: counts[Role.superAdmin]!,
                    color: Palette.warn,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _Stat(
                    label: 'Admins',
                    value: counts[Role.admin]!,
                    color: Palette.brand,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _Stat(
                    label: 'Employees',
                    value: counts[Role.employee]!,
                    color: Palette.ink,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _filterController,
              onChanged: (v) => setState(() => _filter = v),
              decoration: InputDecoration(
                hintText: 'Filter by name or email',
                fillColor: Palette.bgDeepest,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadii.md),
                  borderSide: BorderSide.none,
                ),
                isDense: true,
              ),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text(_error!, style: AppTextStyles.sm(color: Palette.bad)),
            ),
          const SizedBox(height: 8),
          Expanded(
            child: users.isEmpty
                ? Center(
                    child: Text(
                      'Loading…',
                      style: AppTextStyles.sm(color: Palette.inkMuted),
                    ),
                  )
                : visible.isEmpty
                ? Center(
                    child: Text(
                      'No match for that filter.',
                      style: AppTextStyles.sm(color: Palette.inkMuted),
                    ),
                  )
                : ListView.builder(
                    itemCount: visible.length,
                    itemBuilder: (context, index) {
                      final u = visible[index];
                      return ListTile(
                        leading: Avatar(
                          name: u.name,
                          src: u.photoURL,
                          size: 32,
                        ),
                        title: Row(
                          children: [
                            Flexible(
                              child: Text(
                                u.name,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (u.id == me?.id) ...[
                              const SizedBox(width: 6),
                              Text(
                                '(you)',
                                style: AppTextStyles.xs(color: Palette.inkDim),
                              ),
                            ],
                          ],
                        ),
                        subtitle: Row(
                          children: [
                            Flexible(
                              child: Text(
                                u.email,
                                overflow: TextOverflow.ellipsis,
                                style: AppTextStyles.xs(color: Palette.inkDim),
                              ),
                            ),
                            const SizedBox(width: 6),
                            RoleBadge(role: u.role),
                          ],
                        ),
                        trailing: DropdownButton<Role>(
                          value: u.role,
                          underline: const SizedBox.shrink(),
                          onChanged: _busyUid == u.id || me == null
                              ? null
                              : (role) => role != null
                                    ? _onChangeRole(u, role, me.id)
                                    : null,
                          items: Role.values
                              .map(
                                (r) => DropdownMenuItem(
                                  value: r,
                                  child: Text(
                                    r.label,
                                    style: AppTextStyles.sm(),
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.color});
  final String label;
  final int value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Palette.bgRaised,
        border: Border.all(color: Palette.lineSubtle),
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppTextStyles.xs(
              color: Palette.inkDim,
              weight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '$value',
            style: AppTextStyles.lg(color: color, weight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}
