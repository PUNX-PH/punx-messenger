import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../providers/auth_providers.dart';
import '../../providers/emojis_providers.dart';
import '../../providers/messages_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/palette.dart';
import 'composer.dart';
import 'message_list.dart';
import 'pinned_messages_sheet.dart';
import 'search_sheet.dart';
import 'typing_indicator.dart';

/// Generic chat surface shared by DM, channel, and notes screens — port of
/// components/ChatSurface.jsx: header (search/pinned), message loop (load,
/// send, reply, edit, delete, react, pin, mark-read, typing).
class ChatSurface extends ConsumerStatefulWidget {
  const ChatSurface({
    super.key,
    required this.title,
    required this.path,
    this.icon = '#',
    this.composerPlaceholder,
    required this.emptyTitle,
    required this.emptyDesc,
    this.canDeleteAny = false,
    this.canPin = false,
    this.headerActions,
  });

  final String title;
  final String
  path; // e.g. 'dms/<id>/messages', 'groups/<g>/channels/<c>/messages'
  final String icon; // '#' | '@' | '✎'
  final String? composerPlaceholder;
  final String emptyTitle;
  final String emptyDesc;
  final bool canDeleteAny;
  final bool canPin;
  final List<Widget>? headerActions;

  @override
  ConsumerState<ChatSurface> createState() => _ChatSurfaceState();
}

class _ChatSurfaceState extends ConsumerState<ChatSurface> {
  Timer? _markReadDebounce;
  String? _jumpToId;

  @override
  void dispose() {
    _markReadDebounce?.cancel();
    super.dispose();
  }

  void _scheduleMarkRead() {
    _markReadDebounce?.cancel();
    _markReadDebounce = Timer(const Duration(milliseconds: 400), () {
      ref.read(chatControllerProvider(widget.path).notifier).markRead();
    });
  }

  void _jumpTo(String id) {
    setState(() => _jumpToId = null);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      setState(() => _jumpToId = id);
    });
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(messagesProvider(widget.path));
    final messages = messagesAsync.valueOrNull ?? const <ChatMessage>[];
    final usersById = ref.watch(usersByIdProvider);
    final emojiByName = ref.watch(emojiByNameProvider);
    // Active only, for the @-picker and for resolving a typed mention — a
    // removed teammate can't be pinged by name.
    final users = ref.watch(activeUsersProvider);
    final meUid = ref.watch(authStateProvider).valueOrNull?.uid;

    final containerPath = widget.path.startsWith('users/')
        ? null
        : widget.path.replaceFirst(RegExp(r'/messages$'), '');
    final typingNames = containerPath == null
        ? const <String>[]
        : ref.watch(typingNamesProvider(containerPath));

    final controllerState = ref.watch(chatControllerProvider(widget.path));
    final controller = ref.read(chatControllerProvider(widget.path).notifier);

    ref.listen(messagesProvider(widget.path), (prev, next) {
      if (next.valueOrNull != null) _scheduleMarkRead();
    });

    return Scaffold(
      backgroundColor: Palette.bgMain,
      appBar: AppBar(
        title: Row(
          children: [
            Text(widget.icon, style: const TextStyle(color: Palette.inkDim)),
            const SizedBox(width: 6),
            Flexible(
              child: Text(widget.title, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            tooltip: 'Search this chat',
            onPressed: () => showSearchSheet(
              context,
              messages: messages,
              usersById: usersById,
              onJump: _jumpTo,
            ),
          ),
          IconButton(
            icon: const Icon(Icons.push_pin_outlined),
            tooltip: 'Pinned messages',
            onPressed: () => showPinnedMessagesSheet(
              context,
              messages: messages,
              canPin: widget.canPin,
              onJump: _jumpTo,
              onUnpin: (m) => controller.togglePin(m),
            ),
          ),
          ...?widget.headerActions,
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: MessageListView(
              messages: messages,
              meUid: meUid,
              usersById: usersById,
              emojiByName: emojiByName,
              canDeleteAny: widget.canDeleteAny,
              canPin: widget.canPin,
              emptyTitle: widget.emptyTitle,
              emptyDesc: widget.emptyDesc,
              scrollToId: _jumpToId,
              onReply: controller.setReplyingTo,
              onEdit: (m, text) => controller.edit(m, text),
              onDelete: (m) => controller.delete(m),
              onTogglePin: (m) => controller.togglePin(m),
              onReact: (m, key) => controller.react(m, key),
              onJumpToMessage: _jumpTo,
            ),
          ),
          TypingIndicator(names: typingNames),
          Composer(
            placeholder:
                widget.composerPlaceholder ??
                'Message ${widget.icon}${widget.title}',
            users: users,
            meUid: meUid,
            replyingTo: controllerState.replyingTo,
            onCancelReply: () => controller.setReplyingTo(null),
            onTyping: containerPath == null ? null : controller.setTyping,
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
                  );
                },
          ),
        ],
      ),
    );
  }
}
