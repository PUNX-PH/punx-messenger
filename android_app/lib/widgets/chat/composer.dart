import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../markdown/mention_resolver.dart';
import '../../models/message.dart';
import '../../models/user_profile.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../services/attachment_picker.dart';
import '../../services/draft_store.dart';
import '../../services/user_error.dart';
import '../../utils/attachments.dart';
import '../../utils/constants.dart';
import '../../utils/formatting.dart';
import 'format_bar.dart';
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

final _mentionQueryRe = RegExp(r'(?:^|\s)@([\w-]{0,30})$');

class _MentionQuery {
  final int atIndex; // index of '@' within the full text
  final String query;
  const _MentionQuery(this.atIndex, this.query);
}

/// Message input — port of components/Composer.jsx: pictures (several at once, each its own
/// message: see utils/attachments.dart), reply
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
    this.drafts,
    this.draftKey,
    this.pickImages = pickAttachments,
  });

  final String placeholder;
  final ComposerSend onSend;
  final List<UserProfile> users;
  final String? meUid;
  final ValueChanged<bool>? onTyping;
  final ChatMessage? replyingTo;
  final VoidCallback? onCancelReply;

  /// Where unsent text is kept, and the key for THIS conversation (account +
  /// path). Both null means no drafts, which is how the composer worked before.
  final DraftStore? drafts;
  final String? draftKey;

  /// Opens the gallery and returns what was chosen. A parameter so a test can choose without one.
  final Future<List<Attachment>> Function() pickImages;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  /// The row of formatting buttons above the box (opened by the button in the box).
  bool _formatOpen = false;
  /// The pictures waiting to be sent, in the order they were chosen.
  List<Attachment> _files = const [];
  bool _sending = false;
  String? _error;

  /// While sending several: which one is going, of how many (for the box's hint).
  ({int done, int total})? _progress;

  bool _typingActive = false;
  DateTime? _lastTypingPing;
  Timer? _stopTypingTimer;

  _MentionQuery? _mention;
  final Map<String, String> _mentionHints = {};

  @override
  void initState() {
    super.initState();
    // Put back what was typed here last time. Before the listener below is added,
    // so restoring a draft does not count as typing.
    final saved = widget.drafts?.get(widget.draftKey) ?? '';
    if (saved.isNotEmpty) {
      _controller.value = TextEditingValue(
        text: saved,
        selection: TextSelection.collapsed(offset: saved.length),
      );
    }
    _lastDraftText = saved;
    // Every change to the box, typed or not (a picked @mention, an emoji, the box
    // emptied after a send), keeps the draft current; an empty box clears it.
    _controller.addListener(_saveDraft);
  }

  String _lastDraftText = '';

  void _saveDraft() {
    final text = _controller.text;
    if (text == _lastDraftText) return; // a cursor move, not an edit
    _lastDraftText = text;
    widget.drafts?.set(widget.draftKey, text);
  }

  @override
  void dispose() {
    _stopTypingTimer?.cancel();
    _stopTypingNow();
    _controller.removeListener(_saveDraft);
    _controller.dispose();
    _focus.dispose();
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

  /// Bold, italic, strikethrough, code or spoiler on what is selected (see utils/formatting.dart). The
  /// selection afterwards is on the same words, so pressing it again takes the formatting off. A box
  /// that has never had a selection formats at its end.
  void _format(String name) {
    if (_sending) return;
    final text = _controller.text;
    final sel = _controller.selection;
    final r = applyFormat(
      text,
      sel.isValid ? sel.start : text.length,
      sel.isValid ? sel.end : text.length,
      name,
    );
    _controller.value = TextEditingValue(
      text: r.text,
      selection: TextSelection(baseOffset: r.start, extentOffset: r.end),
    );
    _focus.requestFocus();
    _onTextChanged(r.text);
  }

  Future<void> _pickImages() async {
    final List<Attachment> picked;
    try {
      picked = await widget.pickImages();
    } catch (e) {
      if (mounted) setState(() => _error = describeError(e, action: 'open your pictures'));
      return;
    }
    if (picked.isEmpty || !mounted) return;
    final added = addAttachments(_files, picked);
    setState(() {
      _files = added.files;
      _error = added.problem;
    });
  }

  void _removeImage(int index) {
    setState(() => _files = [..._files]..removeAt(index));
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
    if (rawText.trim().isEmpty && _files.isEmpty) return;

    setState(() {
      _sending = true;
      _error = null;
      _mention = null;
    });
    _stopTypingNow();

    final sentFiles = _files;
    try {
      final resolved = resolveMentions(rawText, widget.users, _mentionHints);
      final result = await sendAttachments(
        text: resolved,
        files: sentFiles,
        send: ({required text, file}) => widget.onSend(
          text: text,
          imageBytes: file?.bytes,
          imageName: file?.name,
        ),
        onProgress: (done, total) {
          if (mounted) setState(() => _progress = (done: done, total: total));
        },
      );
      if (!mounted) return;
      final failure = result.error;
      if (failure != null) {
        // The text went with the first message, so once anything has gone it is spent; the pictures
        // that did not go stay, for another try. If nothing went, all of it is kept.
        final said = describeError(failure, action: 'send that message');
        if (result.sent > 0) {
          _controller.clear();
          _mentionHints.clear();
        }
        setState(() {
          if (result.sent > 0) _files = remainingAfter(sentFiles, result.sent);
          // (More than one picture, by definition: one that failed had nothing sent before it.)
          _error = result.sent > 0
              ? 'Sent ${result.sent} of ${sentFiles.length}. $said'
              : said;
        });
        return;
      }
      _controller.clear();
      _mentionHints.clear();
      setState(() => _files = const []);
    } catch (e) {
      if (mounted) setState(() => _error = describeError(e, action: 'send that message'));
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
          _progress = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canSend =
        !_sending &&
        (_controller.text.trim().isNotEmpty || _files.isNotEmpty);
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
              if (_files.isNotEmpty)
                _AttachmentTray(
                  files: _files,
                  busy: _sending,
                  onRemove: _removeImage,
                ),
              if (_formatOpen) FormatBar(onFormat: _format, enabled: !_sending),
              if (_progress != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    uploadingText(_progress!.done, _progress!.total),
                    style: AppTextStyles.xs(color: Palette.inkMuted),
                  ),
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
                    tooltip: 'Add pictures',
                    onPressed: _sending ? null : _pickImages,
                  ),
                  IconButton(
                    tooltip: 'GIF',
                    icon: Icon(Icons.gif_box_outlined, color: Palette.inkMuted),
                    onPressed: _sending ? null : _pickGif,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      focusNode: _focus,
                      minLines: 1,
                      maxLines: 6,
                      onChanged: _onTextChanged,
                      style: AppTextStyles.base(),
                      decoration: InputDecoration(
                        hintText: widget.placeholder,
                        suffixIcon: IconButton(
                          tooltip: 'Formatting',
                          visualDensity: VisualDensity.compact,
                          icon: Icon(
                            Icons.text_format,
                            color: _formatOpen ? Palette.brand : Palette.inkMuted,
                          ),
                          onPressed: () =>
                              setState(() => _formatOpen = !_formatOpen),
                        ),
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
                    tooltip: _sending ? 'Sending' : 'Send message',
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
    final snippet = replyingTo.previewText;
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
                      color: Palette.brandText,
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

/// The pictures waiting to be sent: a thumbnail each, with a way to take one back out. Sideways, so ten
/// of them take one row of the screen, not half of it.
class _AttachmentTray extends StatelessWidget {
  const _AttachmentTray({
    required this.files,
    required this.busy,
    required this.onRemove,
  });
  final List<Attachment> files;

  /// Sending: nothing can be taken out now.
  final bool busy;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    final n = files.length;
    return Semantics(
      container: true,
      label: '$n ${n == 1 ? 'picture' : 'pictures'} to send',
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        height: 76,
        decoration: BoxDecoration(
          color: Palette.bgDeepest,
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.all(6),
          itemCount: n,
          separatorBuilder: (_, _) => const SizedBox(width: 6),
          itemBuilder: (context, i) {
            final f = files[i];
            return SizedBox(
              key: ValueKey('attachment-${f.name}-${f.size}'),
              width: 64,
              height: 64,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadii.sm),
                      child: Image.memory(
                        f.bytes,
                        fit: BoxFit.cover,
                        cacheWidth: 160,
                        gaplessPlayback: true,
                        errorBuilder: (_, _, _) => Container(
                          color: Palette.bgRaised,
                          alignment: Alignment.center,
                          child: Icon(
                            Icons.broken_image_outlined,
                            color: Palette.inkMuted,
                          ),
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    top: -4,
                    right: -4,
                    child: IconButton(
                      tooltip: 'Remove ${f.name}',
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints.tightFor(
                        width: 32,
                        height: 32,
                      ),
                      padding: EdgeInsets.zero,
                      style: IconButton.styleFrom(
                        backgroundColor: Palette.bgRaised.withValues(alpha: 0.9),
                      ),
                      icon: Icon(Icons.close, size: 16, color: Palette.ink),
                      onPressed: busy ? null : () => onRemove(i),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
