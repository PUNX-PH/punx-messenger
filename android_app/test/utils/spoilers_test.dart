import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/markdown/message_parser.dart';
import 'package:punx_messenger/utils/spoilers.dart';

List<MessageToken> tokens(String text) =>
    (parseMessage(text).single as ParagraphBlock).tokens;

String kind(MessageToken t) => switch (t) {
  TextRun() => 'text',
  UrlToken() => 'url',
  EmojiToken() => 'emoji',
  MentionToken() => 'mention',
  SpoilerToken() => 'spoiler',
};

List<String> kinds(String text) => tokens(text).map(kind).toList();

void main() {
  group('what is a spoiler', () {
    test('the placeholder', () {
      expect(spoilerPlaceholder, '[spoiler]');
    });

    test('bars that touch the words on both sides are a spoiler', () {
      for (final s in ['||x||', '||secret||', '||the butler did it||', '||a b c||', '||1||', '||é||', '||a.b!||', '||[x]||', '||https://x.test||']) {
        expect(isSpoiler(s), isTrue, reason: s);
      }
    });

    test('bars with a space just inside are not (code, tables, "a || b")', () {
      for (final s in ['|| x ||', '||x ||', '|| x||', '||  ||', '|| ||', '||\tx||', '||x\t||']) {
        expect(isSpoiler(s), isFalse, reason: s);
      }
    });

    test('nothing inside is not a spoiler', () {
      for (final s in ['||||', '|||', '||', '|']) {
        expect(isSpoiler(s), isFalse, reason: s);
      }
    });

    test('no bar, and no line break, inside', () {
      for (final s in ['||a|b||', '||a||b||', '||a\nb||', '||a\n||', '||\na||']) {
        expect(isSpoiler(s), isFalse, reason: s.replaceAll('\n', r'\n'));
      }
    });

    test('it must be the whole piece', () {
      for (final s in ['x||a||', '||a||x', ' ||a||', '||a|| ']) {
        expect(isSpoiler(s), isFalse, reason: s);
      }
    });

    test('what is inside, without the bars', () {
      expect(spoilerInner('||secret||'), 'secret');
      expect(spoilerInner('||a b||'), 'a b');
      expect(spoilerInner('||x||'), 'x');
    });
  });

  group('hiding it as plain text', () {
    test('each spoiler becomes "[spoiler]", the rest is left as it was', () {
      expect(hideSpoilers('the ending is ||the butler||!'), 'the ending is [spoiler]!');
      expect(hideSpoilers('||a|| and ||b||'), '[spoiler] and [spoiler]');
      expect(hideSpoilers('||only||'), '[spoiler]');
      expect(hideSpoilers('nothing to hide'), 'nothing to hide');
      expect(hideSpoilers(''), '');
    });

    test('things that only look like a spoiler stay as they are', () {
      for (final s in ['a || b || c', 'x || y', 'if (a || b) {}', '||||', '|| ||', 'a | b', '|||']) {
        expect(hideSpoilers(s), s, reason: s);
      }
    });

    test('hiding twice is hiding once', () {
      final once = hideSpoilers('a ||b|| c');
      expect(hideSpoilers(once), once);
    });

    test('nothing of the hidden words is left, with emoji, mentions and links inside', () {
      expect(hideSpoilers('see ||:fire: <@abcdef12> https://x.test/s||'), 'see [spoiler]');
    });
  });

  group('found among the other pieces', () {
    test('a spoiler is a piece of its own, with words either side', () {
      expect(kinds('the ending is ||the butler|| really'), ['text', 'spoiler', 'text']);
      final t = tokens('the ending is ||the butler|| really');
      expect((t[0] as TextRun).text, 'the ending is ');
      expect((t[2] as TextRun).text, ' really');
    });

    test('alone, at the start, at the end', () {
      expect(kinds('||x||'), ['spoiler']);
      expect(kinds('||x|| after'), ['spoiler', 'text']);
      expect(kinds('before ||x||'), ['text', 'spoiler']);
    });

    test('several in one message', () {
      expect(kinds('||a|| and ||b||'), ['spoiler', 'text', 'spoiler']);
      expect(kinds('||a||||b||'), ['spoiler', 'spoiler']);
    });

    test('not a spoiler: no piece of that kind', () {
      for (final t in ['a || b || c', '||||', '|| x ||', 'x || y', '||a|b||']) {
        expect(kinds(t), isNot(contains('spoiler')), reason: t);
      }
    });

    test('code wins where it starts first: bars inside code are not a spoiler', () {
      final t = tokens('`a||b||c`');
      expect(t, hasLength(1));
      expect((t.single as TextRun).code, isTrue);
    });

    test('a spoiler that starts first wins over what is inside it, and holds it as pieces', () {
      final t = tokens('||**bold** and :fire: <@abcdef12>||');
      expect(t, hasLength(1));
      final inner = (t.single as SpoilerToken).children;
      expect(inner.map(kind), ['text', 'text', 'emoji', 'text', 'mention']);
      expect((inner.first as TextRun).bold, isTrue);
    });

    test('a link inside is a piece of the spoiler, not of the message', () {
      final t = tokens('||https://x.test||');
      expect(t, hasLength(1));
      expect(((t.single as SpoilerToken).children.single as UrlToken).url, 'https://x.test');
    });

    test('a piece before a spoiler on the same line does not swallow it', () {
      expect(kinds('**b** ||s||'), ['text', 'text', 'spoiler']);
      expect(kinds('https://x.test ||s||'), ['url', 'text', 'spoiler']);
    });

    test('every other piece is still found exactly as before', () {
      expect(kinds('**b** https://e.test :fire: <@abcdef12>'), ['text', 'text', 'url', 'text', 'emoji', 'text', 'mention']);
    });

    test('a spoiler with nothing inside it but text holds one run of it', () {
      final inner = (tokens('||plain words||').single as SpoilerToken).children;
      expect(inner, hasLength(1));
      expect((inner.single as TextRun).text, 'plain words');
    });
  });
}
