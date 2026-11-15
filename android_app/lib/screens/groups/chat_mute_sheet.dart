import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../theme/palette.dart';
import '../../utils/muted.dart';

/// The long-press menu of one channel or DM in a list: Mute / Unmute, then any
/// [extra] rows the caller adds (a channel's access, for an admin). Port of the
/// right-click menu in ChannelSidebar.jsx and DMsSidebar.jsx.
///
/// [readKey] is the conversation's read key (`pathToReadKey` of its path) and [what]
/// the word the menu uses for it: "channel" or "conversation".
void showChatMenuSheet(
  BuildContext context,
  WidgetRef ref, {
  required String readKey,
  required String what,
  List<Widget Function(BuildContext sheetContext)> extra = const [],
}) {
  final profile = ref.read(profileProvider).valueOrNull;
  if (profile == null) return;
  final muted = isChatMuted(profile, readKey);
  final repo = ref.read(groupsRepositoryProvider);
  // Taken before the sheet closes: the sheet's own context is gone by then.
  final messenger = ScaffoldMessenger.maybeOf(context);

  showModalBottomSheet<void>(
    context: context,
    backgroundColor: Palette.bgRaised,
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: Icon(
              muted
                  ? Icons.notifications_off_outlined
                  : Icons.notifications_outlined,
              color: Palette.ink,
            ),
            title: Text(muteLabel(muted, what)),
            onTap: () async {
              Navigator.of(sheetContext).pop();
              try {
                await repo.setChatMuted(profile.id, readKey, !muted);
              } catch (_) {
                messenger
                  ?..hideCurrentSnackBar()
                  ..showSnackBar(
                    const SnackBar(content: Text("Couldn't change that.")),
                  );
              }
            },
          ),
          for (final row in extra) row(sheetContext),
        ],
      ),
    ),
  );
}
