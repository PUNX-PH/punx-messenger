import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/channel.dart';
import '../../models/role.dart';
import '../../models/user_profile.dart';
import '../../providers/groups_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../widgets/shared/avatar.dart';
import '../../widgets/shared/role_badge.dart';

/// Who can see one channel. Port of `components/ChannelAccessModal.jsx`.
///
/// Two knobs, and explaining the difference is most of this screen's job:
///
///   Private   hides the channel from group members who aren't on the list.
///             Group and workspace admins still see it, same as Discord.
///   The list  `allowUids`. For a GUEST it is the only thing that counts:
///             guests see nothing except channels naming them, so adding a
///             guest to a PUBLIC channel works without making it private.
///
/// Hence guests get their own section framed as an invitation, while everyone
/// else is framed as an exception to "private" — copied from the web, because
/// the distinction confuses people otherwise.
///
/// NOT ported: the web modal also generates a channel-scoped invite link for
/// someone not yet in the group. Android has no invite-creation service at all
/// yet, so that needs building before it can appear here.
class ChannelAccessSheet extends ConsumerStatefulWidget {
  const ChannelAccessSheet({
    super.key,
    required this.groupId,
    required this.channel,
    required this.memberUids,
  });

  final String groupId;
  final Channel channel;
  final List<String> memberUids;

  static Future<void> show(
    BuildContext context, {
    required String groupId,
    required Channel channel,
    required List<String> memberUids,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: Palette.bgRaised,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => ChannelAccessSheet(
        groupId: groupId,
        channel: channel,
        memberUids: memberUids,
      ),
    );
  }

  @override
  ConsumerState<ChannelAccessSheet> createState() => _ChannelAccessSheetState();
}

class _ChannelAccessSheetState extends ConsumerState<ChannelAccessSheet> {
  late bool _private = widget.channel.private;
  late final Set<String> _allow = {...widget.channel.allowUids};
  bool _busy = false;
  String? _error;

  bool get _dirty =>
      _private != widget.channel.private ||
      !_setEquals(_allow, widget.channel.allowUids.toSet());

  static bool _setEquals(Set<String> a, Set<String> b) =>
      a.length == b.length && a.containsAll(b);

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(groupsRepositoryProvider).setChannelAccess(
            widget.groupId,
            widget.channel.id,
            isPrivate: _private,
            allowUids: _allow,
          );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Could not save. $e';
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final usersById = ref.watch(usersByIdProvider);

    // Guests split out from members, as on the web: for them the list is an
    // invitation rather than an exception.
    final people = widget.memberUids
        .map((uid) => usersById[uid])
        .whereType<UserProfile>()
        .toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    final guests = people.where((u) => u.role == Role.guest).toList();
    final members = people.where((u) => u.role != Role.guest).toList();

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(
                children: [
                  Icon(
                    _private ? Icons.lock_outline : Icons.tag,
                    size: 18,
                    color: Palette.inkDim,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      widget.channel.name,
                      style: AppTextStyles.base(),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
            SwitchListTile(
              value: _private,
              onChanged: _busy ? null : (v) => setState(() => _private = v),
              title: Text('Private channel', style: AppTextStyles.sm()),
              subtitle: Text(
                _private
                    ? 'Hidden from group members who are not listed below. '
                        'Admins can still see it.'
                    : 'Everyone in the group can see this channel.',
                style: AppTextStyles.xs(color: Palette.inkMuted),
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  if (guests.isNotEmpty) ...[
                    _SectionLabel(
                      label: 'Guests',
                      hint: 'Guests only ever see channels that name them, so '
                          'adding one here works whether or not the channel '
                          'is private.',
                    ),
                    ...guests.map(_personRow),
                  ],
                  if (members.isNotEmpty) ...[
                    _SectionLabel(
                      label: 'Members',
                      hint: _private
                          ? 'Listed members keep access while this channel is '
                              'private.'
                          : 'Only matters once the channel is private.',
                    ),
                    ...members.map(_personRow),
                  ],
                  if (people.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'Nobody else is in this group yet.',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.sm(color: Palette.inkMuted),
                      ),
                    ),
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Text(_error!, style: AppTextStyles.xs(color: Palette.bad)),
              ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Row(
                children: [
                  TextButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: (_busy || !_dirty) ? null : _save,
                    child: Text(_busy ? 'Saving…' : 'Save'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _personRow(UserProfile u) {
    final checked = _allow.contains(u.id);
    return CheckboxListTile(
      value: checked,
      onChanged: _busy
          ? null
          : (v) => setState(() {
                if (v == true) {
                  _allow.add(u.id);
                } else {
                  _allow.remove(u.id);
                }
              }),
      controlAffinity: ListTileControlAffinity.trailing,
      title: Row(
        children: [
          Avatar(name: u.name, src: u.photoURL, size: 24),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              u.name,
              style: AppTextStyles.sm(),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          RoleBadge(role: u.role, size: RoleBadgeSize.xs),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label, required this.hint});

  final String label;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: AppTextStyles.xs(color: Palette.inkDim, weight: FontWeight.w700),
          ),
          const SizedBox(height: 2),
          Text(hint, style: AppTextStyles.xs(color: Palette.inkMuted)),
        ],
      ),
    );
  }
}
