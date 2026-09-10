import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../markdown/mention_resolver.dart';
import '../../models/message.dart';
import '../../models/user_profile.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/constants.dart';
import 'gif_picker_sheet.dart';
import 'mention_autocomplete_overlay.dart';

typedef ComposerSend =
    Future<void> Function({
      required String text,
      Uint8List? imageBytes,
      String? imageName,
      // A GIF is already hosted, so it travels as a URL rather than bytes.
      String? remoteImageUrl,
      Map<String, dynamic>? remoteImageMeta,
    });

const _maxImageBytes = 10 * 1024 * 1024;

final _mentionQueryRe = RegExp(r'(?:^|\s)@([\w-]{0,30})$');

class _MentionQuery {
  final int atIndex; // index of '@' within the full text
  final String query;
  const _MentionQuery(this.atIndex, this.query);
}

/// Message input — port of components/Composer.jsx: image attach, reply
/// preview, the typing-ping throttle, and @mention autocomplete (candidates
/// picked here are recorded in a chunk->uid hint map applied first at send
/// time; manually-typed "@Name" without picking from the dropdown still
/// resolves via mention_resolver's exact-name fallback).
class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.placeholder,
    required this.onSend,
    required this.users,
    this.meUid,
    this.onTyping,
    this.replyingTo,
    this.onCancelReply,
  });

  final String placeholder;
  final ComposerSend onSend;
  final List<UserProfile> users;
  final String? meUid;
  final ValueChanged<bool>? onTyping;
  final ChatMessage? replyingTo;
  final VoidCallback? onCancelReply;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  Uint8List? _imageBytes;
  String? _imageName;
  bool _sending = false;
  String? _error;

  bool _typingActive = false;
  DateTime? _lastTypingPing;
  Timer? _stopTypingTimer;

  _MentionQuery? _mention;
  final Map<String, String> _mentionHints = {};

  @override
  void dispose() {
    _stopTypingTimer?.cancel();
    _stopTypingNow();
    _controller.dispose();
    super.dispose();
  }

  void _onTextChanged(String text) {
    setState(() {}); // refresh send-button enabled state
    _updateMentionQuery(text);
    if (text.trim().isEmpty) {
      _stopTypingNow();
      return;
    }
    _pingTyping();
  }

  void _updateMentionQuery(String text) {
    final cursor = _controller.selection.baseOffset;
    if (cursor < 0 || cursor > text.length) {
      if (_mention != null) setState(() => _mention = null);
      return;
    }
    final before = text.substring(0, cursor);
    final match = _mentionQueryRe.firstMatch(before);
    if (match == null) {
      if (_mention != null) setState(() => _mention = null);
      return;
    }
    final atIndex = before.lastIndexOf('@');
    setState(() => _mention = _MentionQuery(atIndex, match.group(1) ?? ''));
  }

  List<UserProfile> get _mentionCandidates {
    final mention = _mention;
    if (mention == null) return const [];
    final q = mention.query.toLowerCase();
    return widget.users
        .where((u) {
          if (u.id == widget.meUid) return false;
          if (q.isEmpty) return true;
          final localPart = u.email.split('@').first.toLowerCase();
          return u.name.toLowerCase().contains(q) || localPart.contains(q);
        })
        .take(8)
        .toList();
  }

  void _pickMention(UserProfile u) {
    final mention = _mention;
    if (mention == null) return;
    final text = _controller.text;
    final endIndex = (mention.atIndex + 1 + mention.query.length).clamp(
      0,
      text.length,
    );
    final insertion = '@${u.name} ';
    final newText = text.replaceRange(mention.atIndex, endIndex, insertion);
    _mentionHints['@${u.name}'] = u.id;
    _controller.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(
        offset: mention.atIndex + insertion.length,
      ),
    );
    setState(() => _mention = null);
  }

  void _pingTyping() {
    final now = DateTime.now();
    final shouldPing =
        !_typingActive ||
        _lastTypingPing == null ||
        now.difference(_lastTypingPing!).inMilliseconds >=
            AppTiming.typingPingThrottleMs;
    if (shouldPing) {
      _typingActive = true;
      _lastTypingPing = now;
      widget.onTyping?.call(true);
    }
    _stopTypingTimer?.cancel();
    _stopTypingTimer = Timer(
      const Duration(milliseconds: AppTiming.typingStopAfterMs),
      _stopTypingNow,
    );
  }

  void _stopTypingNow() {
    _stopTypingTimer?.cancel();
    if (_typingActive) {
      _typingActive = false;
      widget.onTyping?.call(false);
    }
  }

  Future<void> _pickImage() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.lengthInBytes > _maxImageBytes) {
      setState(() => _error = 'Image is larger than 10 MB.');
      return;
    }
    setState(() {
      _imageBytes = bytes;
      _imageName = file.name;
      _error = null;
    });
  }

  void _removeImage() {
    setState(() {
      _imageBytes = null;
      _imageName = null;
    });
  }

  Future<void> _pickGif() async {
    final gif = await showGifPickerSheet(context);
    if (gif == null || !mounted) return;
    setState(() => _sending = true);
    try {
      await widget.onSend(
        text: '',
        remoteImageUrl: gif.sendUrl,
        remoteImageMeta: gif.sendMeta,
      );
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to send.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _submit() async {
    final rawText = _controller.text;
    if (rawText.trim().isEmpty && _imageBytes == null) return;

    setState(() {
      _sending = true;
      _error = null;
      _mention = null;
    });
    _stopTypingNow();

    try {
      final resolved = resolveMentions(rawText, widget.users, _mentionHints);
      await widget.onSend(
        text: resolved,
        imageBytes: _imageBytes,
        imageName: _imageName,
      );
      _controller.clear();
      _mentionHints.clear();
      setState(() {
        _imageBytes = null;
        _imageName = null;
      });
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canSend =
        !_sending &&
        (_controller.text.trim().isNotEmpty || _imageBytes != null);
    final mentionCandidates = _mentionCandidates;

    return ColoredBox(
      color: Palette.bgRaised,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (widget.replyingTo != null)
                _ReplyPreviewBar(
                  replyingTo: widget.replyingTo!,
                  onCancel: widget.onCancelReply,
                ),
              if (_imageBytes != null)
                _ImagePreview(
                  bytes: _imageBytes!,
                  name: _imageName ?? '',
                  onRemove: _removeImage,
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    _error!,
                    style: AppTextStyles.xs(color: Palette.bad),
                  ),
                ),
              if (_mention != null && mentionCandidates.isNotEmpty)
                MentionAutocompleteOverlay(
                  candidates: mentionCandidates,
                  onPick: _pickMention,
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    icon: Icon(
                      Icons.add_photo_alternate_outlined,
                      color: Palette.inkMuted,
                    ),
                    onPressed: _sending ? null : _pickImage,
                  ),
                  IconButton(
                    tooltip: 'GIF',
                    icon: Icon(Icons.gif_box_outlined,
                        color: Palette.inkMuted),
                    onPressed: _sending ? null : _pickGif,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      minLines: 1,
                      maxLines: 6,
                      onChanged: _onTextChanged,
                      style: AppTextStyles.base(),
                      decoration: InputDecoration(
                        hintText: widget.placeholder,
                        fillColor: Palette.bgDeepest,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(AppRadii.md),
                          borderSide: BorderSide.none,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    onPressed: canSend ? _submit : null,
                    icon: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                    color: canSend ? Palette.brand : Palette.inkDim,
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

class _ReplyPreviewBar extends StatelessWidget {
  const _ReplyPreviewBar({required this.replyingTo, this.onCancel});
  final ChatMessage replyingTo;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final snippet = replyingTo.text.isNotEmpty
        ? replyingTo.text
        : (replyingTo.imageURL != null ? '[image]' : '');
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Palette.bgDeepest,
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: 'Replying to ',
                    style: AppTextStyles.xs(color: Palette.inkMuted),
                  ),
                  TextSpan(
                    text: '@${replyingTo.author.name}',
                    style: AppTextStyles.xs(
                      color: Palette.brand,
                      weight: FontWeight.w600,
                    ),
                  ),
                  TextSpan(
                    text: ': $snippet',
                    style: AppTextStyles.xs(color: Palette.inkMuted),
                  ),
                ],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          GestureDetector(
            onTap: onCancel,
            child: Icon(Icons.close, size: 16, color: Palette.inkDim),
          ),
        ],
      ),
    );
  }
}

class _ImagePreview extends StatelessWidget {
  const _ImagePreview({
    required this.bytes,
    required this.name,
    required this.onRemove,
  });
  final Uint8List bytes;
  final String name;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Palette.bgDeepest,
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadii.sm),
            child: Image.memory(
              bytes,
              width: 44,
              height: 44,
              fit: BoxFit.cover,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.xs(color: Palette.inkMuted),
            ),
          ),
          IconButton(
            icon: Icon(Icons.close, size: 16, color: Palette.inkDim),
            onPressed: onRemove,
          ),
        ],
      ),
    );
  }
}
