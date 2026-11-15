import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../providers/auth_providers.dart';
import '../../providers/dm_providers.dart';
import '../../providers/groups_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/copy_text.dart';
import '../../utils/forward_targets.dart';
import '../shared/avatar.dart';

/// "Forward to...": pick a person, a channel or your notes and the message goes there as a new
/// message from you, marked "Forwarded from" whoever wrote it. Port of ForwardDialog.jsx. What is
/// copied, and what is not, is utils/forward.dart. One destination at a time; a note says where it
/// went.
///
/// [send] does the forwarding to one destination and says whether it went.
Future<void> showForwardSheet(
  BuildContext context, {
  required ChatMessage message,
  required String currentPath,
  required Future<bool> Function(ForwardTarget target) send,
}) async {
  // Taken before the sheet opens: the sheet's own context is gone by the time it has closed.
  final messenger = ScaffoldMessenger.maybeOf(context);
  final sentTo = await showModalBottomSheet<ForwardTarget>(
    context: context,
    backgroundColor: Palette.bgRaised,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) =>
        ForwardSheet(message: message, currentPath: currentPath, send: send),
  );
  if (sentTo == null) return;
  messenger
    ?..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text('Forwarded to ${forwardedToName(sentTo)}'),
        duration: const Duration(seconds: 2),
      ),
    );
}

class ForwardSheet extends ConsumerStatefulWidget {
  const ForwardSheet({
    super.key,
    required this.message,
    required this.currentPath,
    required this.send,
  });

  final ChatMessage message;
  final String currentPath;
  final Future<bool> Function(ForwardTarget target) send;

  @override
  ConsumerState<ForwardSheet> createState() => _ForwardSheetState();
}

class _ForwardSheetState extends ConsumerState<ForwardSheet> {
  final _query = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _forward(ForwardTarget target) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    bool ok;
    try {
      ok = await widget.send(target);
    } catch (_) {
      ok = false;
    }
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop(target);
    } else {
      setState(() {
        _error = "Couldn't forward it. Check your connection and try again.";
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(profileProvider).valueOrNull;
    final usersById = ref.watch(usersByIdProvider);
    final groups = ref.watch(myGroupsProvider).valueOrNull ?? const [];
    final targets = me == null
        ? const <ForwardTarget>[]
        : buildForwardTargets(
            meUid: me.id,
            users: ref.watch(activeUsersProvider),
            convosByOther:
                ref.watch(myDmConvosProvider).valueOrNull ?? const {},
            groups: groups,
            channelsByGroup: {
              for (final g in groups)
                g.id: ref.watch(channelsProvider(g.id)).valueOrNull ?? const [],
            },
            lastRead: me.lastRead,
            mutedGroups: me.mutedGroups.toSet(),
            mutedChats: me.mutedChats.toSet(),
            currentPath: widget.currentPath,
          );
    final results = rankForwardTargets(targets, _query.text);
    final author =
        usersById[widget.message.author.uid]?.name ??
        widget.message.author.name;
    final preview = forwardPreviewLine(
      copyableText(widget.message, usersById),
      hasVoice: widget.message.voice != null,
    );

    return Padding(
      // Lifts the sheet above the keyboard.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.7,
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Forward message', style: AppTextStyles.lg()),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: Palette.bgDeepest,
                    border: Border.all(color: Palette.lineSubtle),
                    borderRadius: BorderRadius.circular(AppRadii.md),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        author,
                        style: AppTextStyles.xs(color: Palette.inkDim),
                      ),
                      Text(
                        preview,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.sm(color: Palette.inkMuted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _query,
                  autofocus: true,
                  enabled: !_busy,
                  onChanged: (_) => setState(() {}),
                  style: AppTextStyles.sm(),
                  decoration: InputDecoration(
                    hintText: 'Search for a person or channel…',
                    prefixIcon: Icon(
                      Icons.search,
                      size: 18,
                      color: Palette.inkDim,
                    ),
                    fillColor: Palette.bgDeepest,
                    filled: true,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadii.md),
                      borderSide: BorderSide.none,
                    ),
                    isDense: true,
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!, style: AppTextStyles.sm(color: Palette.bad)),
                ],
                const SizedBox(height: 4),
                Flexible(
                  child: results.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.symmetric(vertical: 24),
                          child: Center(
                            child: Text(
                              'Nothing matches "${_query.text.trim()}".',
                              style: AppTextStyles.sm(color: Palette.inkMuted),
                            ),
                          ),
                        )
                      : ListView.builder(
                          shrinkWrap: true,
                          itemCount: results.length,
                          itemBuilder: (context, i) {
                            final t = results[i];
                            return Opacity(
                              opacity: _busy ? 0.6 : 1,
                              child: ListTile(
                                dense: true,
                                onTap: () => _forward(t),
                                leading: SizedBox(
                                  width: 28,
                                  height: 28,
                                  child: Center(
                                    child: t.kind == TargetKind.dm
                                        ? Avatar(
                                            name: t.label,
                                            src: t.user?.photoURL,
                                            size: 26,
                                          )
                                        : Text(
                                            t.kind == TargetKind.channel
                                                ? '#'
                                                : '✎',
                                            style: AppTextStyles.base(
                                              color: Palette.inkDim,
                                            ),
                                          ),
                                  ),
                                ),
                                title: Text(
                                  t.label,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppTextStyles.sm(),
                                ),
                                subtitle: t.hint.isEmpty
                                    ? null
                                    : Text(
                                        t.kind == TargetKind.channel
                                            ? 'in ${t.hint}'
                                            : t.hint,
                                        overflow: TextOverflow.ellipsis,
                                        style: AppTextStyles.xs(
                                          color: Palette.inkDim,
                                        ),
                                      ),
                              ),
                            );
                          },
                        ),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    child: const Text('Cancel'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
