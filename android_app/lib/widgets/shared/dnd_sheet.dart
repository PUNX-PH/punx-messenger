import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/dnd.dart';

/// Opens the "how long" sheet. Port of DndDialog.jsx.
Future<void> showDndSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Palette.bgRaised,
    showDragHandle: true,
    builder: (_) => const DndSheet(),
  );
}

/// A time of day the way this phone's clock is set, for "until 3:40 PM" / "until 15:40".
String _timeText(BuildContext context, DateTime t) =>
    MaterialLocalizations.of(context).formatTimeOfDay(
      TimeOfDay.fromDateTime(t),
      alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
    );

/// The row in the profile sheet: "Do not disturb", and while it is on, how long it has left. Tapping
/// it when it is off asks how long; tapping it when it is on switches it off.
class DndRow extends ConsumerWidget {
  const DndRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = DateTime.now();
    final dnd = activeDndOf(ref.watch(profileProvider).valueOrNull, now);
    return ListTile(
      leading: Icon(
        Icons.notifications_off_outlined,
        color: dnd == null ? Palette.inkDim : Palette.bad,
      ),
      title: Text('Do not disturb', style: AppTextStyles.sm()),
      subtitle: dnd == null
          ? null
          : Text(
              'On, ${dndLabel(dnd, now, (t) => _timeText(context, t))}. Tap to turn it off.',
              style: AppTextStyles.xs(color: Palette.inkMuted),
            ),
      onTap: dnd == null ? () => showDndSheet(context) : () => _turnOff(context, ref),
    );
  }

  Future<void> _turnOff(BuildContext context, WidgetRef ref) async {
    final me = ref.read(profileProvider).valueOrNull;
    if (me == null) return;
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await ref.read(usersRepositoryProvider).setMyDnd(me.id, null);
    } catch (_) {
      messenger?.showSnackBar(
        const SnackBar(content: Text("Couldn't turn it off. Try again.")),
      );
    }
  }
}

/// The sheet that asks how long to be left alone. One tap on a choice switches it on and closes the
/// sheet. What is stored, and when it ends, is models/dnd.dart and utils/dnd.dart.
class DndSheet extends ConsumerStatefulWidget {
  const DndSheet({super.key});

  @override
  ConsumerState<DndSheet> createState() => _DndSheetState();
}

class _DndSheetState extends ConsumerState<DndSheet> {
  bool _busy = false;
  String? _error;

  Future<void> _choose(String id) async {
    if (_busy) return;
    final me = ref.read(profileProvider).valueOrNull;
    if (me == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(usersRepositoryProvider)
          .setMyDnd(me.id, buildDnd(id, DateTime.now()));
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = "Couldn't turn it on. Try again.";
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Do not disturb', style: AppTextStyles.lg()),
            const SizedBox(height: 4),
            Text(
              'No sounds and no notifications, for DMs and @mentions. Messages still arrive and show as unread.',
              style: AppTextStyles.xs(color: Palette.inkDim),
            ),
            const SizedBox(height: 8),
            for (final o in dndOptions)
              ListTile(
                contentPadding: EdgeInsets.zero,
                enabled: !_busy,
                title: Text(o.label, style: AppTextStyles.sm()),
                onTap: () => _choose(o.id),
              ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: AppTextStyles.sm(color: Palette.bad)),
            ],
          ],
        ),
      ),
    );
  }
}
