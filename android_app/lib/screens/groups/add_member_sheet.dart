import 'package:flutter/material.dart';

import '../../models/group.dart';
import '../../models/user_profile.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/add_member.dart';
import '../../widgets/shared/avatar.dart';

/// The list of people who can be added to [group], as a bottom sheet. Tapping
/// a name closes the sheet and calls [onAdd] with that person; adding is the
/// caller's job, because the two places that open this (the group's channel
/// list and its settings) report a failure in their own way.
///
/// One sheet for both, so adding a member looks and behaves the same wherever
/// you start.
Future<void> showAddMemberSheet(
  BuildContext context, {
  required Group group,
  required Iterable<UserProfile> users,
  required void Function(UserProfile user) onAdd,
}) {
  final people = addableUsers(group, users);
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Palette.bgRaised,
    builder: (sheetContext) {
      return SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            if (people.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'Everyone is already in this group.',
                  style: AppTextStyles.sm(color: Palette.inkMuted),
                ),
              ),
            for (final u in people)
              ListTile(
                leading: Avatar(name: u.name, src: u.photoURL, size: 28),
                title: Text(u.name),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  onAdd(u);
                },
              ),
          ],
        ),
      );
    },
  );
}
