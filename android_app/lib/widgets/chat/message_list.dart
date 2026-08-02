import 'package:flutter/material.dart';

import '../../models/custom_emoji.dart';
import '../../models/message.dart';
import '../../models/user_profile.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/constants.dart';
import 'message_row.dart';

/// Scrollable message feed — port of components/MessageList.jsx. Handles
/// Discord-style same-author/5-min clustering and jump-to-message (used by
/// reply-quote taps, and later by search/pinned-message jumps in Phase 6).
class MessageListView extends StatefulWidget {
  const MessageListView({
    super.key,
    required this.messages,
    required this.meUid,
    required this.usersById,
    required this.emojiByName,
    required this.canDeleteAny,
    required this.emptyTitle,
    required this.emptyDesc,
    this.canPin = false,
    this.scrollToId,
    this.onReply,
    this.onEdit,
    this.onDelete,
    this.onTogglePin,
    this.onReact,
    this.onJumpToMessage,
  });

  final List<ChatMessage> messages;
  final String? meUid;
  final Map<String, UserProfile> usersById;
  final Map<String, CustomEmoji> emojiByName;
  final bool canDeleteAny;
  final bool canPin;
  final String emptyTitle;
  final String emptyDesc;

  /// Set (to a new, non-null value) to scroll a specific message into view
  /// and briefly highlight it, pausing normal auto-follow-latest behavior.
  final String? scrollToId;

  final ValueChanged<ChatMessage>? onReply;
  final void Function(ChatMessage message, String newText)? onEdit;
  final ValueChanged<ChatMessage>? onDelete;
  final ValueChanged<ChatMessage>? onTogglePin;
  final void Function(ChatMessage message, String key)? onReact;
  final ValueChanged<String>? onJumpToMessage;

  @override
  State<MessageListView> createState() => _MessageListViewState();
}

class _MessageListViewState extends State<MessageListView> {
  final _scrollController = ScrollController();
  final Map<String, GlobalKey> _rowKeys = {};
  String? _highlightId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
  }

  @override
  void didUpdateWidget(covariant MessageListView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.scrollToId != null &&
        widget.scrollToId != oldWidget.scrollToId) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _jumpToMessage(widget.scrollToId!),
      );
    } else if (widget.scrollToId == null &&
        widget.messages.length != oldWidget.messages.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _jumpToBottom() {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      _scrollController.position.maxScrollExtent,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  void _jumpToMessage(String id) {
    final ctx = _rowKeys[id]?.currentContext;
    if (ctx == null) return;
    setState(() => _highlightId = id);
    Scrollable.ensureVisible(
      ctx,
      duration: const Duration(milliseconds: 300),
      alignment: 0.5,
    );
    Future.delayed(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _highlightId = null);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.messages.isEmpty) {
      return _EmptyState(title: widget.emptyTitle, desc: widget.emptyDesc);
    }

    final flat = _flatten(widget.messages);
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: flat.length,
      itemBuilder: (context, index) {
        final entry = flat[index];
        final key = _rowKeys.putIfAbsent(entry.message.id, () => GlobalKey());
        return KeyedSubtree(
          key: key,
          child: MessageRow(
            message: entry.message,
            showHeader: entry.showHeader,
            meUid: widget.meUid,
            usersById: widget.usersById,
            emojiByName: widget.emojiByName,
            canDeleteAny: widget.canDeleteAny,
            canPin: widget.canPin,
            highlighted: _highlightId == entry.message.id,
            onReply: widget.onReply,
            onEdit: widget.onEdit,
            onDelete: widget.onDelete,
            onTogglePin: widget.onTogglePin,
            onReact: widget.onReact,
            onJumpToMessage: widget.onJumpToMessage,
          ),
        );
      },
    );
  }
}

class _FlatMessage {
  final ChatMessage message;
  final bool showHeader;
  const _FlatMessage(this.message, this.showHeader);
}

/// Same-author clustering: a message joins the previous group if the same
/// author sent it within [AppTiming.messageGroupingWindowMs] of the
/// *immediately preceding* message (not the group's first message).
List<_FlatMessage> _flatten(List<ChatMessage> messages) {
  final out = <_FlatMessage>[];
  ChatMessage? prev;
  for (final m in messages) {
    final showHeader =
        prev == null ||
        prev.author.uid != m.author.uid ||
        _msSincePrev(prev, m) >= AppTiming.messageGroupingWindowMs;
    out.add(_FlatMessage(m, showHeader));
    prev = m;
  }
  return out;
}

int _msSincePrev(ChatMessage prev, ChatMessage cur) {
  final p = prev.createdAt?.millisecondsSinceEpoch;
  final c = cur.createdAt?.millisecondsSinceEpoch;
  if (p == null || c == null) {
    return AppTiming
        .messageGroupingWindowMs; // force a new group if a timestamp is missing
  }
  return c - p;
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, required this.desc});
  final String title;
  final String desc;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              textAlign: TextAlign.center,
              style: AppTextStyles.base(weight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Text(
              desc,
              textAlign: TextAlign.center,
              style: AppTextStyles.sm(color: Palette.inkMuted),
            ),
          ],
        ),
      ),
    );
  }
}
