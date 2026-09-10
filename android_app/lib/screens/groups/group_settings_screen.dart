import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../models/group.dart';
import '../../models/user_profile.dart';
import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../providers/users_providers.dart';
import '../../services/groups_repository.dart';
import '../../services/image_service.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../widgets/shared/avatar.dart';

/// Port of components/GroupSettingsModal.jsx, as a full-screen route (the
/// web modal has two dense tabs' worth of content — a bottom sheet would be
/// cramped, especially with the keyboard open while editing the name).
class GroupSettingsScreen extends ConsumerStatefulWidget {
  const GroupSettingsScreen({super.key, required this.groupId});
  final String groupId;

  @override
  ConsumerState<GroupSettingsScreen> createState() =>
      _GroupSettingsScreenState();
}

class _GroupSettingsScreenState extends ConsumerState<GroupSettingsScreen> {
  final _nameController = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _savedNameSeeded;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _wrap(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final group = ref.watch(groupProvider(widget.groupId)).valueOrNull;
    final profile = ref.watch(profileProvider).valueOrNull;

    if (group == null || profile == null) {
      return Scaffold(
        backgroundColor: Palette.bgMain,
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_savedNameSeeded != group.id) {
      _nameController.text = group.name;
      _savedNameSeeded = group.id;
    }

    final canEdit =
        profile.role.isAdmin ||
        group.isAdmin(profile.id) ||
        group.isOwner(profile.id);
    final canManageRoles = profile.role.isAdmin || group.isOwner(profile.id);
    final repo = ref.read(groupsRepositoryProvider);

    return Scaffold(
      backgroundColor: Palette.bgMain,
      appBar: AppBar(title: Text('${group.name} settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _SectionHeader('Overview'),
          const SizedBox(height: 8),
          Row(
            children: [
              GestureDetector(
                onTap: !canEdit || _busy ? null : () => _pickAvatar(repo),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(32),
                  child: SizedBox(
                    width: 64,
                    height: 64,
                    child: group.imageURL != null
                        ? Image.memory(
                            ImageService.decodeDataUrl(group.imageURL!),
                            fit: BoxFit.cover,
                          )
                        : ColoredBox(
                            color: Palette.brand,
                            child: Center(
                              child: Text(
                                group.name.isNotEmpty
                                    ? group.name[0].toUpperCase()
                                    : '?',
                              ),
                            ),
                          ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: TextField(
                  controller: _nameController,
                  enabled: canEdit,
                  maxLength: 50,
                  decoration: InputDecoration(
                    labelText: 'Group name',
                    fillColor: Palette.bgDeepest,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadii.md),
                    ),
                  ),
                ),
              ),
            ],
          ),
          if (canEdit) ...[
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (group.bannerURL != null)
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => _wrap(
                            () => repo.updateGroupBanner(widget.groupId, null),
                          ),
                    child: const Text('Remove banner'),
                  ),
                TextButton(
                  onPressed: _busy ? null : () => _pickBanner(repo),
                  child: const Text('Set banner'),
                ),
                ElevatedButton(
                  onPressed: _busy || _nameController.text.trim().isEmpty
                      ? null
                      : () => _wrap(
                          () => repo.updateGroup(widget.groupId, {
                            'name': _nameController.text.trim(),
                          }),
                        ),
                  child: const Text('Save'),
                ),
              ],
            ),
          ],
          if (_error != null)
            Text(_error!, style: AppTextStyles.sm(color: Palette.bad)),
          const SizedBox(height: 24),
          _SectionHeader('Members — ${group.memberUids.length}'),
          const SizedBox(height: 8),
          _MembersSection(
            group: group,
            canManage: canEdit,
            canManageRoles: canManageRoles,
            busy: _busy,
            onWrap: _wrap,
          ),
        ],
      ),
    );
  }

  Future<void> _pickAvatar(GroupsRepository repo) async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (file == null) return;
    final Uint8List bytes = await file.readAsBytes();
    await _wrap(() => repo.updateGroupAvatar(widget.groupId, bytes));
  }

  Future<void> _pickBanner(GroupsRepository repo) async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (file == null) return;
    final Uint8List bytes = await file.readAsBytes();
    await _wrap(() => repo.updateGroupBanner(widget.groupId, bytes));
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);
  final String text;
  @override
  Widget build(BuildContext context) =>
      Text(text, style: AppTextStyles.sm(weight: FontWeight.w700));
}

class _MembersSection extends ConsumerWidget {
  const _MembersSection({
    required this.group,
    required this.canManage,
    required this.canManageRoles,
    required this.busy,
    required this.onWrap,
  });

  final Group group;
  final bool canManage;
  final bool canManageRoles;
  final bool busy;
  final Future<void> Function(Future<void> Function()) onWrap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final usersById = ref.watch(usersByIdProvider);
    // Removed accounts aren't offerable as new members.
    final allUsers = ref.watch(activeUsersProvider);
    final me = ref.watch(profileProvider).valueOrNull;
    final repo = ref.read(groupsRepositoryProvider);

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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final u in members)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Avatar(name: u.name, src: u.photoURL, size: 32),
            title: Text(u.name),
            subtitle: Text(
              group.isOwner(u.id)
                  ? 'Owner'
                  : (group.isAdmin(u.id) ? 'Group admin' : 'Member'),
              style: AppTextStyles.xs(color: Palette.inkDim),
            ),
            trailing: group.isOwner(u.id) || me == null
                ? null
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (canManageRoles)
                        TextButton(
                          onPressed: busy
                              ? null
                              : () => onWrap(
                                  () => repo.setGroupAdmin(
                                    group.id,
                                    u.id,
                                    !group.isAdmin(u.id),
                                  ),
                                ),
                          child: Text(
                            group.isAdmin(u.id) ? 'Demote' : 'Make admin',
                          ),
                        ),
                      if (canManage && u.id != me.id)
                        IconButton(
                          icon: Icon(
                            Icons.person_remove_outlined,
                            color: Palette.bad,
                          ),
                          onPressed: busy
                              ? null
                              : () => onWrap(
                                  () => repo.removeMember(group.id, u.id),
                                ),
                        ),
                    ],
                  ),
          ),
        if (canManage)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton.icon(
              onPressed: busy
                  ? null
                  : () => _showAddMemberSheet(context, ref, allUsers, repo),
              icon: const Icon(Icons.person_add_alt_outlined),
              label: const Text('Add member'),
            ),
          ),
      ],
    );
  }

  void _showAddMemberSheet(
    BuildContext context,
    WidgetRef ref,
    List<UserProfile> allUsers,
    GroupsRepository repo,
  ) {
    final nonMembers = allUsers
        .where((u) => !group.memberUids.contains(u.id))
        .toList();
    showModalBottomSheet(
      context: context,
      backgroundColor: Palette.bgRaised,
      builder: (sheetContext) {
        return SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: [
              if (nonMembers.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'Everyone is already in this group.',
                    style: AppTextStyles.sm(color: Palette.inkMuted),
                  ),
                ),
              for (final u in nonMembers)
                ListTile(
                  leading: Avatar(name: u.name, src: u.photoURL, size: 28),
                  title: Text(u.name),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    onWrap(() => repo.addMember(group.id, u.id));
                  },
                ),
            ],
          ),
        );
      },
    );
  }
}
