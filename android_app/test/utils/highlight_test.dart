import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/utils/highlight.dart';

List<String> marked(String text, String q) => [
  for (final p in highlightParts(text, q))
    if (p.match) p.text,
];

String joined(String text, String q) =>
    highlightParts(text, q).map((p) => p.text).join();

void main() {
  group('highlightParts', () {
    test('cuts the text into what matches and what is between, in order', () {
      expect(highlightParts('the release notes', 'release'), [
        (text: 'the ', match: false),
        (text: 'release', match: true),
        (text: ' notes', match: false),
      ]);
    });

    test(
      'a match at the very start and at the very end leaves no empty stretch',
      () {
        expect(highlightParts('ab', 'ab'), [(text: 'ab', match: true)]);
        expect(highlightParts('ab cd ab', 'ab'), [
          (text: 'ab', match: true),
          (text: ' cd ', match: false),
          (text: 'ab', match: true),
        ]);
      },
    );

    test(
      'every match is marked, also next to each other and without overlapping',
      () {
        expect(marked('aaaa', 'aa'), ['aa', 'aa']);
        expect(marked('ab ab ab', 'ab'), ['ab', 'ab', 'ab']);
        expect(marked('aaa', 'aa'), ['aa']);
      },
    );

    test(
      'capital letters do not matter, and the text keeps the letters it had',
      () {
        expect(marked('Release RELEASE release', 'ReLeAsE'), [
          'Release',
          'RELEASE',
          'release',
        ]);
      },
    );

    test(
      'no match, no query or no text is a single stretch that is not marked',
      () {
        expect(highlightParts('hello', 'xyz'), [(text: 'hello', match: false)]);
        expect(highlightParts('hello', ''), [(text: 'hello', match: false)]);
        expect(highlightParts('', 'a'), [(text: '', match: false)]);
      },
    );

    test('joining the stretches gives the text back, whatever the query', () {
      for (final (t, q) in [
        ('Morning all. Standup is at 10:30.', 'at'),
        ('a.b.c', '.'),
        ('(x) [y] *z*', '*'),
        ('line one\nline two', 'line'),
        ('emoji 👍 here 👍', '👍'),
        ('accents: café CAFÉ', 'café'),
      ]) {
        expect(joined(t, q), t, reason: '$t / $q');
      }
    });

    test('characters that mean something in a pattern are plain text', () {
      expect(marked('a.b and a+b and a*b', '.'), ['.']);
      expect(marked('a+b and a*b', '+'), ['+']);
      expect(marked('(x) and [y]', '(x)'), ['(x)']);
    });

    test('an emoji and accented letters are matched whole', () {
      expect(marked('great 👍 job', '👍'), ['👍']);
      expect(marked('Un CAFÉ por favor', 'café'), ['CAFÉ']);
    });

    test(
      'positions stay right after letters that are special in other languages',
      () {
        // Lower-casing "İ" (dotted capital I) is two code units in JavaScript and would shift every later
        // position; in Dart it does not, and the second match must still be the second word.
        const text = 'İstanbul and Istanbul and ẞtraße';
        expect(marked(text, 'istanbul'), ['İstanbul', 'Istanbul']);
        expect(marked(text, 'and'), ['and', 'and']);
        expect(joined(text, 'istanbul'), text);
      },
    );

    test(
      'no character changes its length when lower-cased, so positions can be trusted',
      () {
        for (var c = 0; c <= 0x10FFFF; c++) {
          if (c >= 0xD800 && c <= 0xDFFF) continue;
          final s = String.fromCharCode(c);
          if (s.toLowerCase().length != s.length) {
            fail('U+${c.toRadixString(16)} changes length');
          }
        }
      },
    );
  });
}
