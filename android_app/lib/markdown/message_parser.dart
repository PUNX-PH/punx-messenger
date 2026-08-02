/// Pure text-parsing layer, ported 1:1 from src/lib/markdown.jsx's hand-rolled
/// regex parser (no markdown library — custom emoji/mention tokens need to
/// interleave with formatting, which a generic markdown widget can't do
/// without a custom builder anyway).
///
/// This file only produces plain data (tokens/blocks) — turning them into
/// actual `InlineSpan`s/widgets (with emoji image lookups, mention-name
/// resolution, tap handling) is widgets/chat/message_renderer.dart's job, so
/// this stays unit-testable without a widget tree.
library;

sealed class MessageToken {
  const MessageToken();
}

class TextRun extends MessageToken {
  final String text;
  final bool bold;
  final bool italic;
  final bool strike;
  final bool code;
  const TextRun(
    this.text, {
    this.bold = false,
    this.italic = false,
    this.strike = false,
    this.code = false,
  });
}

class UrlToken extends MessageToken {
  final String url;
  const UrlToken(this.url);
}

/// A `:name:` custom-emoji token. Rendering falls back to the literal
/// `:name:` text if `name` isn't a known custom emoji.
class EmojiToken extends MessageToken {
  final String name;
  const EmojiToken(this.name);
}

/// A `<@uid>` mention token.
class MentionToken extends MessageToken {
  final String uid;
  const MentionToken(this.uid);
}

sealed class MessageBlock {
  const MessageBlock();
}

class ParagraphBlock extends MessageBlock {
  final List<MessageToken> tokens;
  const ParagraphBlock(this.tokens);
}

class CodeBlockBlock extends MessageBlock {
  final String code;
  const CodeBlockBlock(this.code);
}

final _codeBlockRe = RegExp(r'```([\s\S]*?)```');

final _inlineRe = RegExp(
  [
    r'(`[^`\n]+?`)', // 1 inline code
    r'(\*\*[^*\n]+?\*\*)', // 2 bold
    r'(~~[^~\n]+?~~)', // 3 strike
    r'(\*[^*\n]+?\*)', // 4 italic *
    r'(_[^_\n]+?_)', // 5 italic _
    r'(https?://[^\s<>]+)', // 6 url
    r'(:[a-z0-9_]{2,32}:)', // 7 emoji
    r'(<@[A-Za-z0-9_-]{6,40}>)', // 8 mention
  ].join('|'),
  caseSensitive: false,
);

/// Parses message text into a sequence of blocks: paragraphs (inline
/// formatting/tokens) interleaved with fenced code blocks.
List<MessageBlock> parseMessage(String? text) {
  if (text == null || text.isEmpty) return const [];

  final blocks = <MessageBlock>[];
  var lastIdx = 0;

  for (final m in _codeBlockRe.allMatches(text)) {
    if (m.start > lastIdx) {
      blocks.add(
        ParagraphBlock(_parseInline(text.substring(lastIdx, m.start))),
      );
    }
    final code = (m.group(1) ?? '')
        .replaceFirst(RegExp(r'^\n'), '')
        .replaceFirst(RegExp(r'\n$'), '');
    blocks.add(CodeBlockBlock(code));
    lastIdx = m.end;
  }
  if (lastIdx < text.length) {
    blocks.add(ParagraphBlock(_parseInline(text.substring(lastIdx))));
  }

  return blocks;
}

List<MessageToken> _parseInline(String text) {
  final tokens = <MessageToken>[];
  var lastIdx = 0;

  for (final m in _inlineRe.allMatches(text)) {
    if (m.start > lastIdx) {
      tokens.add(TextRun(text.substring(lastIdx, m.start)));
    }

    final code = m.group(1);
    final bold = m.group(2);
    final strike = m.group(3);
    final italic1 = m.group(4);
    final italic2 = m.group(5);
    final url = m.group(6);
    final emoji = m.group(7);
    final mention = m.group(8);

    if (code != null) {
      tokens.add(TextRun(code.substring(1, code.length - 1), code: true));
    } else if (bold != null) {
      tokens.add(TextRun(bold.substring(2, bold.length - 2), bold: true));
    } else if (strike != null) {
      tokens.add(TextRun(strike.substring(2, strike.length - 2), strike: true));
    } else if (italic1 != null) {
      tokens.add(
        TextRun(italic1.substring(1, italic1.length - 1), italic: true),
      );
    } else if (italic2 != null) {
      tokens.add(
        TextRun(italic2.substring(1, italic2.length - 1), italic: true),
      );
    } else if (url != null) {
      tokens.add(UrlToken(url));
    } else if (emoji != null) {
      tokens.add(
        EmojiToken(emoji.substring(1, emoji.length - 1).toLowerCase()),
      );
    } else if (mention != null) {
      tokens.add(MentionToken(mention.substring(2, mention.length - 1)));
    }

    lastIdx = m.end;
  }
  if (lastIdx < text.length) {
    tokens.add(TextRun(text.substring(lastIdx)));
  }

  return tokens;
}

final _onlyEmojisRe = RegExp(
  r'^(\s*:[a-z0-9_]{2,32}:\s*)+$',
  caseSensitive: false,
);

/// True if the message text is only emoji tokens (and whitespace) — such
/// messages render at a larger size (see MessageList.jsx).
bool isOnlyEmojis(String? text) {
  final t = (text ?? '').trim();
  return t.isNotEmpty && _onlyEmojisRe.hasMatch(t);
}
