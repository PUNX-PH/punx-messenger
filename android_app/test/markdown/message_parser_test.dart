import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/markdown/message_parser.dart';

void main() {
  group('parseMessage', () {
    test('plain text produces a single paragraph with one text run', () {
      final blocks = parseMessage('hello world');
      expect(blocks, hasLength(1));
      final tokens = (blocks.single as ParagraphBlock).tokens;
      expect(tokens, hasLength(1));
      expect((tokens.single as TextRun).text, 'hello world');
    });

    test('bold, italic, strike, and inline code tokens', () {
      final tokens =
          (parseMessage(
                    '**bold** *italic* _also italic_ ~~strike~~ `code`',
                  ).single
                  as ParagraphBlock)
              .tokens
              .whereType<TextRun>()
              .toList();
      expect(tokens.where((t) => t.bold).single.text, 'bold');
      expect(tokens.where((t) => t.italic).map((t) => t.text), [
        'italic',
        'also italic',
      ]);
      expect(tokens.where((t) => t.strike).single.text, 'strike');
      expect(tokens.where((t) => t.code).single.text, 'code');
    });

    test('bare URL becomes a UrlToken', () {
      final tokens =
          (parseMessage('see https://punx.ai/docs for more').single
                  as ParagraphBlock)
              .tokens;
      final urls = tokens.whereType<UrlToken>().toList();
      expect(urls, hasLength(1));
      expect(urls.single.url, 'https://punx.ai/docs');
    });

    test(':emoji: token is lowercased', () {
      final tokens =
          (parseMessage('nice :Party_Time:').single as ParagraphBlock).tokens;
      expect(tokens.whereType<EmojiToken>().single.name, 'party_time');
    });

    test('<@uid> becomes a MentionToken', () {
      final tokens =
          (parseMessage('hey <@abc123XYZ_-1>').single as ParagraphBlock).tokens;
      expect(tokens.whereType<MentionToken>().single.uid, 'abc123XYZ_-1');
    });

    test(
      'fenced code block becomes its own block, stripped of surrounding newlines',
      () {
        final blocks = parseMessage('before\n```\nline1\nline2\n```\nafter');
        expect(blocks, hasLength(3));
        expect(blocks[0], isA<ParagraphBlock>());
        expect((blocks[1] as CodeBlockBlock).code, 'line1\nline2');
        expect(blocks[2], isA<ParagraphBlock>());
      },
    );

    test('empty text yields no blocks', () {
      expect(parseMessage(''), isEmpty);
      expect(parseMessage(null), isEmpty);
    });
  });

  group('isOnlyEmojis', () {
    test('true for one or more emoji tokens with only whitespace between', () {
      expect(isOnlyEmojis(':fire:'), isTrue);
      expect(isOnlyEmojis(' :fire:  :100: '), isTrue);
    });

    test('false when mixed with real text or empty', () {
      expect(isOnlyEmojis('nice :fire:'), isFalse);
      expect(isOnlyEmojis(''), isFalse);
      expect(isOnlyEmojis(null), isFalse);
    });
  });
}
