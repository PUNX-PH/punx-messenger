import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../markdown/message_parser.dart';
import '../../models/custom_emoji.dart';
import '../../models/user_profile.dart';
import '../../services/image_service.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// Renders message text with markdown + custom-emoji + mention tokens —
/// widget-layer counterpart to markdown/message_parser.dart's pure parsing,
/// mirroring markdown.jsx's renderMessage().
class MessageRenderer extends StatelessWidget {
  const MessageRenderer({
    super.key,
    required this.text,
    required this.emojiByName,
    required this.usersById,
    this.emojiSize = 22,
    this.style,
  });

  final String text;
  final Map<String, CustomEmoji> emojiByName;
  final Map<String, UserProfile> usersById;
  final double emojiSize;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final blocks = parseMessage(text);
    if (blocks.isEmpty) return const SizedBox.shrink();
    final baseStyle = style ?? AppTextStyles.base();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final block in blocks)
          if (block is CodeBlockBlock)
            _CodeBlockView(code: block.code)
          else
            _ParagraphView(
              tokens: (block as ParagraphBlock).tokens,
              emojiByName: emojiByName,
              usersById: usersById,
              emojiSize: emojiSize,
              baseStyle: baseStyle,
            ),
      ],
    );
  }
}

class _ParagraphView extends StatefulWidget {
  const _ParagraphView({
    required this.tokens,
    required this.emojiByName,
    required this.usersById,
    required this.emojiSize,
    required this.baseStyle,
  });

  final List<MessageToken> tokens;
  final Map<String, CustomEmoji> emojiByName;
  final Map<String, UserProfile> usersById;
  final double emojiSize;
  final TextStyle baseStyle;

  @override
  State<_ParagraphView> createState() => _ParagraphViewState();
}

class _ParagraphViewState extends State<_ParagraphView> {
  final List<TapGestureRecognizer> _recognizers = [];

  @override
  void dispose() {
    _disposeRecognizers();
    super.dispose();
  }

  void _disposeRecognizers() {
    for (final r in _recognizers) {
      r.dispose();
    }
    _recognizers.clear();
  }

  @override
  Widget build(BuildContext context) {
    _disposeRecognizers();
    return RichText(
      softWrap: true,
      text: TextSpan(
        style: widget.baseStyle,
        children: [for (final t in widget.tokens) _spanFor(t)],
      ),
    );
  }

  InlineSpan _spanFor(MessageToken token) {
    switch (token) {
      case TextRun():
        var style = widget.baseStyle;
        if (token.bold) style = style.copyWith(fontWeight: FontWeight.w700);
        if (token.italic) style = style.copyWith(fontStyle: FontStyle.italic);
        if (token.strike) {
          style = style.copyWith(decoration: TextDecoration.lineThrough);
        }
        if (token.code) {
          return WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              decoration: BoxDecoration(
                color: Palette.bgDeepest,
                border: Border.all(color: Palette.lineSubtle),
                borderRadius: BorderRadius.circular(AppRadii.xs),
              ),
              child: Text(
                token.text,
                style: style.copyWith(
                  fontFamily: 'monospace',
                  fontSize: (style.fontSize ?? 15) * 0.875,
                ),
              ),
            ),
          );
        }
        return TextSpan(text: token.text, style: style);

      case UrlToken():
        final recognizer = TapGestureRecognizer()
          ..onTap = () => _openUrl(token.url);
        _recognizers.add(recognizer);
        return TextSpan(
          text: token.url,
          style: widget.baseStyle.copyWith(
            color: Palette.brand,
            decoration: TextDecoration.underline,
          ),
          recognizer: recognizer,
        );

      case EmojiToken():
        final emoji = widget.emojiByName[token.name];
        if (emoji == null) {
          return TextSpan(text: ':${token.name}:', style: widget.baseStyle);
        }
        return WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 1),
            child: Image.memory(
              ImageService.decodeDataUrl(emoji.dataURL),
              width: widget.emojiSize,
              height: widget.emojiSize,
            ),
          ),
        );

      case MentionToken():
        final user = widget.usersById[token.uid];
        return WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
            margin: const EdgeInsets.symmetric(horizontal: 1),
            decoration: BoxDecoration(
              color: Palette.brandSoft,
              borderRadius: BorderRadius.circular(AppRadii.xs),
            ),
            child: Text(
              '@${user?.name ?? 'Unknown'}',
              style: widget.baseStyle.copyWith(
                color: Palette.brand,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        );
    }
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

class _CodeBlockView extends StatelessWidget {
  const _CodeBlockView({required this.code});
  final String code;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Palette.bgDeepest,
        border: Border.all(color: Palette.lineSubtle),
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Text(
          code,
          style: TextStyle(
            fontFamily: 'monospace',
            fontSize: 13,
            color: Palette.ink,
          ),
        ),
      ),
    );
  }
}
