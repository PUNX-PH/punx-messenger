import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../providers/auth_providers.dart';
import '../../providers/draft_providers.dart';
import '../../providers/emojis_providers.dart';
import '../../providers/messages_providers.dart';
import '../../providers/users_providers.dart';
import '../../services/user_error.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/threads.dart';
import 'composer.dart';
import 'message_row.dart';

/// A message and the replies to it, on a screen of their own: the phone's version of the web's
/// thread panel. The replies are read with their own query (every reply to this message, not only
/// the ones in the part of the conversation that is loaded), and a reply written here goes to the
/// conversation too, quoting this message, as any reply does. Reading and replying only: editing,
/// deleting and reacting stay in the conversation ("Show in chat").
class ThreadScreen extends ConsumerStatefulWidget {
  const ThreadScreen({
    super.key,
    required this.path,
    required this.opened,
    this.onShowInChat,
    this.onSeen,
  });

  /// The conversation's messages path (`dms/<id>/messages`, `groups/<g>/channels/<c>/messages`).
  final String path;

  /// The message as it was when the thread was opened. Its current copy is taken from the
  /// conversation while that is loaded (see currentRoot).
  final ChatMessage opened;

  /// Takes the reader to a message in the conversation, which this screen closes first.
  final ValueChanged<String>? onShowInChat;

  /// Told which replies are on screen, as they change, so the conversation can stop counting them as
  /// new (see markThreadSeen). Called after the frame, never while building.
  final void Function(String rootId, List<ChatMessage> replies)? onSeen;

  @override
  ConsumerState<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends ConsumerState<ThreadScreen> {
  final _scroll = ScrollController();
  int _seenReplies = 0;

  /// The newest reply time last reported through onSeen: only a newer one is worth telling (a reply
  /// going away cannot make a thread unseen).
  int? _reportedMs;

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// Looking at the thread is what makes its replies not new any more: what is on screen, as it
  /// changes. Told after the frame, because the conversation rebuilds when it hears this.
  void _reportSeen(String rootId, List<ChatMessage> replies) {
    int? newest;
    for (final m in replies) {
      final t = m.createdAt?.millisecondsSinceEpoch;
      if (t != null && (newest == null || t > newest)) newest = t;
    }
    if (newest == null || (_reportedMs != null && newest <= _reportedMs!)) return;
    _reportedMs = newest;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onSeen?.call(rootId, replies);
    });
  }

  /// New replies come in at the bottom, and the screen follows them.
  void _followTo(int count) {
    if (count == _seenReplies) return;
    final grew = count > _seenReplies;
    _seenReplies = count;
    if (!grew) return;
    WidgetsBinding.instance.addPostFrameCallback((_) => _toEnd());
  }

  /// A ListView only knows the height of the rows it has built and estimates the rest, so the end it
  /// reports before a jump is not the end it reports after: jump again, a few times at most, until it
  /// stops moving (the same thing MessageListView does for the conversation).
  Future<void> _toEnd() async {
    for (var attempt = 0; attempt < 4; attempt++) {
      if (!mounted || !_scroll.hasClients) return;
      final p = _scroll.position;
      if (p.maxScrollExtent - p.pixels <= 1) return;
      _scroll.jumpTo(p.maxScrollExtent);
      await WidgetsBinding.instance.endOfFrame;
    }
  }

  @override
  Widget build(BuildContext context) {
    final path = widget.path;
    final messages =
        ref.watch(messagesProvider(path)).valueOrNull?.messages ??
        const <ChatMessage>[];
    final root = currentRoot(messages, widget.opened);
    final repliesAsync = ref.watch(
      repliesProvider((path: path, rootId: root.id)),
    );
    final loaded = repliesAsync.hasValue;
    final replies = threadReplies(repliesAsync.valueOrNull ?? const [], root.id);
    _followTo(replies.length);
    _reportSeen(root.id, replies);

    final usersById = ref.watch(usersByIdProvider);
    final emojiByName = ref.watch(emojiByNameProvider);
    final users = ref.watch(activeUsersProvider);
    final meUid = ref.watch(authStateProvider).valueOrNull?.uid;
    final controller = ref.read(chatControllerProvider(path).notifier);

    // The replies do not repeat their quote (it is always the message above them); the message
    // keeps its own, if it is itself a reply to something.
    Widget row(ChatMessage m, {bool quote = true}) => MessageRow(
      message: m,
      showHeader: true,
      showReplyQuote: quote,
      meUid: meUid,
      usersById: usersById,
      emojiByName: emojiByName,
      canDeleteAny: false,
    );

    final status = repliesAsync.hasError
        ? describeError(repliesAsync.error!, action: 'load the replies')
        : null;

    return Scaffold(
      backgroundColor: Palette.bgMain,
      appBar: AppBar(title: const Text('Thread')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 840),
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    row(root),
                    _CountDivider(
                      text: !loaded
                          ? (status == null ? 'Loading…' : '')
                          : (replies.isEmpty
                                ? 'No replies yet'
                                : replyLabel(replies.length)),
                    ),
                    if (status != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 4,
                        ),
                        child: Text(
                          status,
                          style: AppTextStyles.sm(color: Palette.bad),
                        ),
                      ),
                    for (final m in replies)
                      KeyedSubtree(
                        key: ValueKey('thread-reply-${m.id}'),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            row(m, quote: false),
                            if (widget.onShowInChat != null)
                              Align(
                                alignment: Alignment.centerRight,
                                child: Padding(
                                  padding: const EdgeInsets.only(right: 12),
                                  child: TextButton(
                                    onPressed: () {
                                      Navigator.of(context).pop();
                                      widget.onShowInChat!(m.id);
                                    },
                                    child: Text(
                                      'Show in chat',
                                      style: AppTextStyles.xs(
                                        color: Palette.inkMuted,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    if (loaded && status == null && replies.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                          'Write the first reply below.',
                          style: AppTextStyles.sm(color: Palette.inkMuted),
                        ),
                      ),
                  ],
                ),
              ),
              Composer(
                placeholder: 'Reply in thread',
                users: users,
                meUid: meUid,
                // Kept per account and thread, apart from what is typed in the conversation itself.
                drafts: ref.read(draftStoreProvider),
                draftKey: meUid == null ? null : '$meUid:$path#thread:${root.id}',
                onSend:
                    ({
                      required String text,
                      Uint8List? imageBytes,
                      String? imageName,
                      String? remoteImageUrl,
                      Map<String, dynamic>? remoteImageMeta,
                    }) {
                      return controller.send(
                        text: text,
                        imageBytes: imageBytes,
                        imageName: imageName,
                        remoteImageUrl: remoteImageUrl,
                        remoteImageMeta: remoteImageMeta,
                        replyTo: root,
                      );
                    },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "3 replies" with a line running on, between the message and its replies.
class _CountDivider extends StatelessWidget {
  const _CountDivider({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      child: Row(
        children: [
          if (text.isNotEmpty) ...[
            Text(text, style: AppTextStyles.xs(color: Palette.inkDim)),
            const SizedBox(width: 12),
          ],
          Expanded(child: Container(height: 1, color: Palette.lineSubtle)),
        ],
      ),
    );
  }
}
