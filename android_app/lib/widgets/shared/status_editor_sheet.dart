import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/custom_status.dart';
import '../../providers/auth_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/status.dart';

/// Opens the status editor. Port of StatusEditor.jsx.
Future<void> showStatusEditor(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Palette.bgRaised,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const StatusEditorSheet(),
  );
}

/// The row in the profile sheet that shows your status ("Set a status" when there is none) and
/// opens the editor.
class StatusRow extends ConsumerWidget {
  const StatusRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mine = activeStatusOf(ref.watch(profileProvider).valueOrNull, DateTime.now());
    return ListTile(
      leading: Icon(Icons.mood_outlined, color: Palette.inkDim),
      title: Text(
        mine?.text ?? 'Set a status',
        style: AppTextStyles.sm(),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: mine == null
          ? null
          : Text('Tap to change it', style: AppTextStyles.xs(color: Palette.inkMuted)),
      onTap: () => showStatusEditor(context),
    );
  }
}

/// The sheet for your own status: a line of text, a few ready-made ones, and how long it stays.
/// What is stored, and how it is cleaned, is models/custom_status.dart and utils/status.dart.
class StatusEditorSheet extends ConsumerStatefulWidget {
  const StatusEditorSheet({super.key});

  @override
  ConsumerState<StatusEditorSheet> createState() => _StatusEditorSheetState();
}

class _StatusEditorSheetState extends ConsumerState<StatusEditorSheet> {
  late final TextEditingController _text;
  String _expiry = 'today';
  bool _busy = false;
  String? _error;
  late final bool _hasExisting;

  @override
  void initState() {
    super.initState();
    final me = ref.read(profileProvider).valueOrNull;
    final existing = activeStatusOf(me, DateTime.now());
    _hasExisting = existing != null;
    _text = TextEditingController(text: existing?.text ?? '');
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  bool get _canSave => cleanStatusText(_text.text).isNotEmpty && !_busy;

  Future<void> _run(Map<String, Object?>? status) async {
    final me = ref.read(profileProvider).valueOrNull;
    if (me == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(usersRepositoryProvider).setMyStatus(me.id, status);
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = "Couldn't save your status. Try again.";
        _busy = false;
      });
    }
  }

  void _save() {
    if (_canSave) _run(buildStatus(_text.text, _expiry, DateTime.now()));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Lifts the sheet above the keyboard.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Set a status', style: AppTextStyles.lg()),
              const SizedBox(height: 4),
              Text(
                'Shown next to your name for everyone you work with.',
                style: AppTextStyles.xs(color: Palette.inkDim),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _text,
                autofocus: true,
                enabled: !_busy,
                maxLength: statusMax,
                textInputAction: TextInputAction.done,
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => _save(),
                style: AppTextStyles.sm(),
                decoration: InputDecoration(
                  hintText: "What's your status?",
                  fillColor: Palette.bgDeepest,
                  filled: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide.none,
                  ),
                  isDense: true,
                ),
              ),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final p in statusPresets)
                    ActionChip(
                      label: Text(p, style: AppTextStyles.xs()),
                      onPressed: _busy
                          ? null
                          : () => setState(() => _text.text = p),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              Text('Clear after', style: AppTextStyles.xs(color: Palette.inkDim)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final o in expiryOptions)
                    ChoiceChip(
                      label: Text(o.label, style: AppTextStyles.xs()),
                      selected: _expiry == o.id,
                      onSelected: _busy
                          ? null
                          : (_) => setState(() => _expiry = o.id),
                    ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: AppTextStyles.sm(color: Palette.bad)),
              ],
              const SizedBox(height: 16),
              // Wraps rather than sits in one row: with Clear status as well, three buttons
              // do not fit a narrow phone side by side.
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  FilledButton(
                    onPressed: _canSave ? _save : null,
                    child: Text(_busy ? 'Saving…' : 'Save'),
                  ),
                  TextButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                  if (_hasExisting)
                    TextButton(
                      onPressed: _busy ? null : () => _run(null),
                      child: Text(
                        'Clear status',
                        style: AppTextStyles.sm(color: Palette.bad),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
