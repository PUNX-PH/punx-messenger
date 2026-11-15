import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// The row in the profile sheet for "Let others see when I've read their messages": the same switch
/// as the web's Preferences (`prefs.shareSeen`), so it holds on both. Off means nothing about you is
/// recorded, the receipts already written are removed, and you do not see theirs either
/// (utils/seen.dart).
class SeenSwitch extends ConsumerWidget {
  const SeenSwitch({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final on = ref.watch(profileProvider.select((p) => p.valueOrNull?.shareSeen ?? true));
    return SwitchListTile(
      secondary: Icon(Icons.done_all, color: Palette.inkDim),
      title: Text("Let others see when I've read their messages", style: AppTextStyles.sm()),
      subtitle: Text(
        'In a direct message, the other person sees "Seen 3:41 PM" under their message once you have opened the chat. Turn it off and nobody sees yours, and you do not see theirs.',
        style: AppTextStyles.xs(color: Palette.inkMuted),
      ),
      value: on,
      onChanged: (v) => _set(context, ref, v),
    );
  }

  Future<void> _set(BuildContext context, WidgetRef ref, bool value) async {
    final me = ref.read(profileProvider).valueOrNull;
    if (me == null) return;
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await ref.read(usersRepositoryProvider).setShareSeen(me.id, value);
    } catch (_) {
      messenger?.showSnackBar(
        const SnackBar(content: Text("Couldn't save that. Try again.")),
      );
    }
  }
}
