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
import '../../utils/constants.dart';
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
    final page = messagesAsync.valueOrNull;
    final messages = page?.messages ?? const <ChatMessage>[];
    final hasMore = page?.hasMore ?? false;
    final usersById = ref.watch(usersByIdProvider);
    final emojiByName = ref.watch(emojiByNameProvider);
    // Active only, for the @-picker and for resolving a typed mention — a
    // removed teammate can't be pinged by name.
    final users = ref.watch(activeUsersProvider);
    final meUid = ref.watch(authStateProvider).valueOrNull?.uid;

    final containerPath = widget.path.startsWith('users/')
        ? null
        : widget.path.replaceFirst(RegExp(r'/messages$'), '');
    // The LABEL, not the name list: see typingLabelProvider on why watching
    // the list here rebuilt this whole surface every two seconds.
    final typingLabel = containerPath == null
        ? null
        : ref.watch(typingLabelProvider(containerPath));

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
            Text(widget.icon, style: TextStyle(color: Palette.inkDim)),
            const SizedBox(width: 6),
            Flexible(
              child: Text(widget.title, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
        // Search and pin moved into the overflow, and the reason is the title.
        //
        // A DM carried four trailing icons — search, pin, call, video — which
        // on a 360dp bar leaves the name about 110dp and renders a two-letter
        // stub: "@ Re…" for a person whose name is the entire point of the
        // screen. Material 3 caps a top app bar at three actions and sends the
        // rest to an overflow for exactly this reason.
        //
        // These two are the ones that go because they are the ones you reach
        // for rarely and deliberately. Call and video stay out, being both
        // frequent and time-sensitive, and a channel now carries the overflow
        // alone.
        actions: [
          ...?widget.headerActions,
          PopupMenuButton<_ChatMenuAction>(
            tooltip: 'More',
            position: PopupMenuPosition.under,
            onSelected: (action) => switch (action) {
              _ChatMenuAction.search => showSearchSheet(
                  context,
                  messages: messages,
                  usersById: usersById,
                  onJump: _jumpTo,
                ),
              _ChatMenuAction.pinned => showPinnedMessagesSheet(
                  context,
                  messages: messages,
                  canPin: widget.canPin,
                  onJump: _jumpTo,
                  onUnpin: (m) => controller.togglePin(m),
                ),
            },
            itemBuilder: (context) => const [
              PopupMenuItem(
                value: _ChatMenuAction.search,
                child: ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.search),
                  title: Text('Search this chat'),
                ),
              ),
              PopupMenuItem(
                value: _ChatMenuAction.pinned,
                child: ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.push_pin_outlined),
                  title: Text('Pinned messages'),
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: MessageListView(
              messages: messages,
              hasMore: hasMore,
              onLoadOlder: () => ref
                  .read(messageLimitProvider(widget.path).notifier)
                  .update((n) => n + AppTiming.messagePageSize),
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
          TypingIndicator(label: typingLabel),
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

/// The two secondary chat actions, which live in the app bar's overflow so the
/// conversation's name keeps the room it needs. See the `actions:` note above.
enum _ChatMenuAction { search, pinned }
