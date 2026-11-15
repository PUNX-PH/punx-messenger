import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../markdown/mention_resolver.dart';
import '../../markdown/message_parser.dart';
import '../../models/custom_emoji.dart';
import '../../models/message.dart';
import '../../models/reply_snapshot.dart';
import '../../models/user_profile.dart';
import '../../providers/presence_providers.dart';
import '../../services/image_service.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/copy_text.dart';
import '../../utils/forward.dart';
import '../../utils/saved.dart';
import '../../utils/time_format.dart';
import '../shared/avatar.dart';
import 'emoji_picker_sheet.dart';
import 'lightbox_viewer.dart';
import 'message_renderer.dart';
import 'reaction_chip.dart';
import 'voice_clip_tile.dart';

/// One message row — port of the per-message rendering in MessageList.jsx
/// (author/name/time header shown once per 5-min author-cluster, reply
/// quote strip, image, rendered text, pinned/edited markers, reactions, and
/// long-press actions: reply/react/pin/edit/delete).
class MessageRow extends ConsumerWidget {
  const MessageRow({
    super.key,
    required this.message,
    required this.showHeader,
    required this.meUid,
    required this.usersById,
    required this.emojiByName,
    required this.canDeleteAny,
    this.canPin = false,
    this.highlighted = false,
    this.seenText = '',
    this.onReply,
    this.onEdit,
    this.onDelete,
    this.onTogglePin,
    this.onReact,
    this.onJumpToMessage,
    this.onSave,
    this.onForward,
  });

  final ChatMessage message;
  final bool showHeader;
  final String? meUid;
  final Map<String, UserProfile> usersById;
  final Map<String, CustomEmoji> emojiByName;
  final bool canDeleteAny;
  final bool canPin;
  final bool highlighted;

  /// "Seen 3:41 PM" under this message (a DM, your latest one the other person has read); nothing
  /// when empty.
  final String seenText;
  final ValueChanged<ChatMessage>? onReply;
  final void Function(ChatMessage message, String newText)? onEdit;
  final ValueChanged<ChatMessage>? onDelete;
  final ValueChanged<ChatMessage>? onTogglePin;
  final void Function(ChatMessage message, String key)? onReact;
  final ValueChanged<String>? onJumpToMessage;

  /// Keeps a copy of this message in My Notes; null where that is not offered.
  final Future<SaveResult> Function(ChatMessage message)? onSave;

  /// Opens the Forward box for this message; null where forwarding is not offered.
  final ValueChanged<ChatMessage>? onForward;

  bool get _isAuthor => meUid != null && message.author.uid == meUid;
  bool get _mentionsMe => mentionsUid(message.text, meUid);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Live author display info from the current users list, falling back
    // to the denormalized snapshot on the message — matches MessageList.jsx.
    final liveAuthor = usersById[message.author.uid];
    final authorName = liveAuthor?.name ?? message.author.name;
    final authorPhoto = liveAuthor?.photoURL ?? message.author.photoURL;
    final authorStatus = ref.watch(statusOfProvider(message.author.uid));

    // Marked by tint, not a coloured left border. A thick stripe down one edge
    // is the generic "alert" look, and the row already says what it is — the
    // pin icon and "Pinned" label, or the highlighted @mention.
    Color? bg;
    if (highlighted) {
      bg = Palette.brand.withValues(alpha: 0.12);
    } else if (_mentionsMe) {
      bg = Palette.warn.withValues(alpha: 0.1);
    } else if (message.pinned) {
      bg = Palette.warn.withValues(alpha: 0.06);
    }

    return GestureDetector(
      onLongPress: () => _showActions(context),
      child: Container(
        color: bg,
        padding: EdgeInsets.only(
          left: 12,
          right: 12,
          top: showHeader ? 8 : 2,
          bottom: 2,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 40,
              child: showHeader
                  ? Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Avatar(
                        name: authorName,
                        src: authorPhoto,
                        size: 36,
                        status: authorStatus,
                        ringColor: Palette.bgMain,
                      ),
                    )
                  : null,
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (showHeader)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Flexible(
                            child: Text(
                              authorName,
                              style: AppTextStyles.sm(weight: FontWeight.w600),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            // Time only: the day is on the divider above.
                            formatClock(
                              message.createdAt,
                              use24h: MediaQuery.alwaysUse24HourFormatOf(
                                context,
                              ),
                            ),
                            style: AppTextStyles.xs(color: Palette.inkDim),
                          ),
                          if (message.pinned) ...[
                            const SizedBox(width: 8),
                            Icon(Icons.push_pin, size: 12, color: Palette.warn),
                          ],
                        ],
                      ),
                    )
                  else if (message.pinned)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.push_pin, size: 11, color: Palette.warn),
                          const SizedBox(width: 4),
                          Text(
                            'Pinned',
                            style: AppTextStyles.xs(color: Palette.warn),
                          ),
                        ],
                      ),
                    ),
                  if (message.forwardedFrom != null)
                    _ForwardedLabel(
                      name: message.forwardedFrom!.name,
                      saved: message.isSavedNote,
                    ),
                  if (message.replyTo != null)
                    _ReplyStrip(
                      reply: message.replyTo!,
                      onTap: onJumpToMessage,
                    ),
                  if (message.imageURL != null)
                    _MessageImage(dataUrl: message.imageURL!),
                  if (message.voice != null) VoiceClipTile(clip: message.voice!),
                  if (message.text.isNotEmpty)
                    MessageRenderer(
                      text: message.text,
                      emojiByName: emojiByName,
                      usersById: usersById,
                      emojiSize: isOnlyEmojis(message.text) ? 40 : 22,
                    ),
                  if (message.editedAt != null)
                    Text(
                      '(edited)',
                      style: AppTextStyles.xs(color: Palette.inkDim),
                    ),
                  if (onReact != null)
                    ReactionChips(
                      reactions: message.reactions,
                      meUid: meUid,
                      emojiByName: emojiByName,
                      onToggle: (key) => onReact!(message, key),
                      onAddReaction: () async {
                        final token = await showEmojiPickerSheet(context);
                        if (token != null) {
                          onReact!(message, token);
                        }
                      },
                    ),
                  if (seenText.isNotEmpty)
                    Align(
                      alignment: Alignment.centerRight,
                      child: Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          seenText,
                          style: AppTextStyles.xs(color: Palette.inkDim),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Puts the message's text on the clipboard, and says so (or says it could not).
  /// `messenger` is taken before the sheet closes: the sheet's own context is gone by then.
  Future<void> _copy(ScaffoldMessengerState? messenger) async {
    String said;
    try {
      await Clipboard.setData(
        ClipboardData(text: copyableText(message, usersById)),
      );
      said = 'Copied';
    } catch (_) {
      said = "Couldn't copy";
    }
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(said), duration: const Duration(seconds: 2)),
      );
  }

  /// Keeps a copy in My Notes, and says how it went.
  Future<void> _save(ScaffoldMessengerState? messenger) async {
    final result = await onSave!(message);
    final said = switch (result) {
      SaveResult.saved => 'Saved to My Notes',
      SaveResult.exists => 'Already saved',
      SaveResult.failed => "Couldn't save",
    };
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(said), duration: const Duration(seconds: 2)),
      );
  }

  void _showActions(BuildContext context) {
    final canEdit = _isAuthor && message.text.isNotEmpty;
    final canDelete = _isAuthor || canDeleteAny;
    final messenger = ScaffoldMessenger.maybeOf(context);

    showModalBottomSheet(
      context: context,
      backgroundColor: Palette.bgRaised,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: Icon(Icons.reply, color: Palette.ink),
                title: const Text('Reply'),
                onTap: () {
                  Navigator.of(context).pop();
                  onReply?.call(message);
                },
              ),
              if (onReact != null)
                ListTile(
                  leading: Icon(
                    Icons.add_reaction_outlined,
                    color: Palette.ink,
                  ),
                  title: const Text('React'),
                  onTap: () async {
                    Navigator.of(context).pop();
                    final token = await showEmojiPickerSheet(context);
                    if (token != null) {
                      onReact!(message, token);
                    }
                  },
                ),
              if (hasCopyableText(message))
                ListTile(
                  leading: Icon(Icons.copy_outlined, color: Palette.ink),
                  title: const Text('Copy text'),
                  onTap: () {
                    Navigator.of(context).pop();
                    _copy(messenger);
                  },
                ),
              if (onForward != null && canForward(message))
                ListTile(
                  leading: Icon(Icons.forward, color: Palette.ink),
                  title: const Text('Forward'),
                  onTap: () {
                    Navigator.of(context).pop();
                    onForward!(message);
                  },
                ),
              if (onSave != null && canForward(message))
                ListTile(
                  leading: Icon(Icons.bookmark_border, color: Palette.ink),
                  title: const Text('Save to My Notes'),
                  onTap: () {
                    Navigator.of(context).pop();
                    _save(messenger);
                  },
                ),
              if (canPin)
                ListTile(
                  leading: Icon(Icons.push_pin_outlined, color: Palette.ink),
                  title: Text(message.pinned ? 'Unpin' : 'Pin'),
                  onTap: () {
                    Navigator.of(context).pop();
                    onTogglePin?.call(message);
                  },
                ),
              if (canEdit)
                ListTile(
                  leading: Icon(Icons.edit_outlined, color: Palette.ink),
                  title: const Text('Edit'),
                  onTap: () {
                    Navigator.of(context).pop();
                    _promptEdit(context);
                  },
                ),
              if (canDelete)
                ListTile(
                  leading: Icon(Icons.delete_outline, color: Palette.bad),
                  title: Text(
                    'Delete',
                    style: TextStyle(color: Palette.bad),
                  ),
                  onTap: () async {
                    Navigator.of(context).pop();
                    final confirmed = await _confirmDelete(context);
                    if (confirmed == true) onDelete?.call(message);
                  },
                ),
            ],
          ),
        );
      },
    );
  }

  Future<bool?> _confirmDelete(BuildContext context) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Palette.bgRaised,
        title: const Text('Delete this message?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text('Delete', style: TextStyle(color: Palette.bad)),
          ),
        ],
      ),
    );
  }

  Future<void> _promptEdit(BuildContext context) async {
    final controller = TextEditingController(text: message.text);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Palette.bgRaised,
        title: const Text('Edit message'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: null,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (result != null && result.trim().isNotEmpty) {
      onEdit?.call(message, result);
    }
  }
}

class _ReplyStrip extends StatelessWidget {
  const _ReplyStrip({required this.reply, this.onTap});
  final ReplySnapshot reply;
  final ValueChanged<String>? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: GestureDetector(
        onTap: () => onTap?.call(reply.messageId),
        child: Row(
          children: [
            Icon(
              Icons.subdirectory_arrow_left,
              size: 13,
              color: Palette.inkDim,
            ),
            const SizedBox(width: 4),
            Text(
              '@${reply.authorName}',
              style: AppTextStyles.xs(
                color: Palette.brandText,
                weight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                reply.snippet,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.xs(color: Palette.inkMuted),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A message's image, which arrives in one of two shapes.
///
/// Uploads are inlined as base64 data URLs (this app has no Firebase Storage),
/// but a GIF from the picker is an https link to Klipy's CDN. Decoding the
/// second as if it were the first throws inside build, and a build that throws
/// paints the default error box — which is the empty grey rectangle GIFs
/// showed everywhere, on both platforms, whichever client sent them.
class _MessageImage extends StatelessWidget {
  const _MessageImage({required this.dataUrl});

  /// Despite the name, either an inline data URL or a remote https URL.
  final String dataUrl;

  @override
  Widget build(BuildContext context) {
    final remote = ImageService.isRemoteUrl(dataUrl);

    Uint8List? bytes;
    if (!remote) {
      try {
        bytes = ImageService.decodeDataUrl(dataUrl);
      } catch (_) {
        // Malformed inline data: show the placeholder rather than taking the
        // whole message list down with us.
        bytes = null;
      }
    }

    final Widget image = remote
        ? Image.network(
            dataUrl,
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => const _ImageUnavailable(),
          )
        : bytes == null
            ? const _ImageUnavailable()
            : Image.memory(bytes, fit: BoxFit.contain);

    void openLightbox() {
      if (remote) {
        LightboxViewer.showUrl(context, dataUrl);
      } else if (bytes != null) {
        LightboxViewer.show(context, bytes);
      }
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: GestureDetector(
        onTap: openLightbox,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 260, maxWidth: 320),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadii.md),
            child: image,
          ),
        ),
      ),
    );
  }
}

/// "Forwarded from Cara" / "Saved from Cara": who wrote a message that is a copy.
class _ForwardedLabel extends StatelessWidget {
  const _ForwardedLabel({required this.name, required this.saved});

  final String name;
  final bool saved;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            saved ? Icons.bookmark_border : Icons.forward,
            size: 12,
            color: Palette.inkDim,
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text.rich(
              TextSpan(
                text: saved ? 'Saved from ' : 'Forwarded from ',
                style: AppTextStyles.xs(color: Palette.inkDim),
                children: [
                  TextSpan(
                    text: name,
                    style: AppTextStyles.xs(color: Palette.inkMuted),
                  ),
                ],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Shown instead of a silent blank box when an image cannot be displayed, so
/// a broken one reads as broken rather than as a rendering glitch.
class _ImageUnavailable extends StatelessWidget {
  const _ImageUnavailable();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 160,
      height: 120,
      color: Palette.bgDeepest,
      alignment: Alignment.center,
      child: Icon(Icons.broken_image_outlined, color: Palette.inkMuted),
    );
  }
}
