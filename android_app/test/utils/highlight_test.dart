import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/utils/highlight.dart';

List<String> marked(String text, String q) => [
  for (final p in highlightParts(text, q))
    if (p.match) p.text,
];

String joined(String text, String q) =>
    highlightParts(text, q).map((p) => p.text).join();

// A mark (an acute accent) written as a character of its own, after a letter.
final acute = String.fromCharCode(0x301);

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
        // "İ" (dotted capital I) folds to "i"; the second match must still be the second word.
        const text = 'İstanbul and Istanbul and ẞtraße';
        expect(marked(text, 'istanbul'), ['İstanbul', 'Istanbul']);
        expect(marked(text, 'and'), ['and', 'and']);
        expect(joined(text, 'istanbul'), text);
      },
    );

    test('accents do not matter, either way round', () {
      expect(marked('Un café, un CAFÉ, un cafe', 'cafe'), [
        'café',
        'CAFÉ',
        'cafe',
      ]);
      expect(marked('Un café, un cafe', 'café'), ['café', 'cafe']);
      expect(marked('Hola José', 'JOSE'), ['José']);
    });

    test(
      'the marks stay where they are in the real text, after other accents and emoji',
      () {
        expect(highlightParts('Ñandú 👍 café', 'cafe'), [
          (text: 'Ñandú 👍 ', match: false),
          (text: 'café', match: true),
        ]);
        expect(marked('éééé x éé', 'ee'), ['éé', 'éé', 'éé']);
      },
    );

    test(
      'a letter and its mark as two characters is marked whole, mark included',
      () {
        final text = 'cafe$acute ok';
        expect(highlightParts(text, 'cafe'), [
          (text: 'cafe$acute', match: true),
          (text: ' ok', match: false),
        ]);
        expect(marked('xe$acute${acute}y', 'e'), ['e$acute$acute']);
      },
    );

    test(
      'a letter that folds into several is marked whole, and the next match is not cut in it',
      () {
        expect(marked('Straße', 'strasse'), ['Straße']);
        expect(marked('Straße', 'stras'), ['Straß']);
        expect(marked('Straße', 'sse'), ['ße']);
        // the second "s" of ß is inside the character the first match already took
        expect(marked('ß', 's'), ['ß']);
        expect(marked('ßß', 's'), ['ß', 'ß']);
      },
    );

    test(
      'after skipping a start inside a character, the very next letter is tried (not a whole query further)',
      () {
        // every letter here folds to "s", so the query "sß" is "sss" and matches at every place
        expect(highlightParts('sßßßSsßS', 'sß'), [
          (text: 'sß', match: true),
          (text: 'ßß', match: true),
          (text: 'Ssß', match: true),
          (text: 'S', match: false),
        ]);
      },
    );

    test(
      'a query that is only a mark folds to nothing and marks nothing (and does not loop)',
      () {
        expect(highlightParts('hello', acute), [(text: 'hello', match: false)]);
      },
    );

    test(
      'a letter from a script Dart is older than (a Cherokee capital) is folded as on the web',
      () {
        final cherokee = String.fromCharCode(
          0x13a0,
        ); // Ꭰ, whose lower case is U+AB70
        final small = String.fromCharCode(0xab70);
        expect(marked('x $cherokee y $small', small), [
          cherokee,
          small,
        ]);
      },
    );

    test('joining the stretches gives the text back, with accents too', () {
      for (final (t, q) in [
        ('accents: café CAFÉ cafe', 'cafe'),
        ('Straße strasse STRASSE', 'strasse'),
        ('e${acute}e$acute ee', 'ee'),
        ('👍é👍', 'e'),
      ]) {
        expect(joined(t, q), t, reason: '$t / $q');
      }
    });
  });
}
