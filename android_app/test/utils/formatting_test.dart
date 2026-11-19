import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/markdown/message_parser.dart';
import 'package:punx_messenger/utils/formatting.dart';

// The new text, what is selected in it, and the selection: as one thing to compare.
({String text, String sel, int start, int end}) run(String text, int s, int e, String name) {
  final r = applyFormat(text, s, e, name);
  return (text: r.text, sel: r.text.substring(r.start, r.end), start: r.start, end: r.end);
}

// Selecting `word` inside `text`.
({String text, String sel, int start, int end}) on(String text, String word, String name, {int nth = 0}) {
  var from = -1;
  for (var i = 0; i <= nth; i++) {
    from = text.indexOf(word, from + 1);
  }
  return run(text, from, from + word.length, name);
}

List<MessageToken> tokens(String text) => (parseMessage(text).single as ParagraphBlock).tokens;

bool isFormat(MessageToken t, String name) => switch ((t, name)) {
  (SpoilerToken(), 'spoiler') => true,
  (TextRun(bold: true), 'bold') => true,
  (TextRun(italic: true), 'italic') => true,
  (TextRun(strike: true), 'strike') => true,
  (TextRun(code: true), 'code') => true,
  _ => false,
};

void main() {
  group('what there is', () {
    test('the formats and their marks', () {
      expect(formats.map((k, v) => MapEntry(k, [v.$1, v.$2])), {
        'bold': ['**', '**'],
        'italic': ['_', '_'],
        'strike': ['~~', '~~'],
        'code': ['`', '`'],
        'spoiler': ['||', '||'],
      });
    });

    test('the buttons: the same formats, in this order, with words', () {
      expect(formatButtons.map((b) => b.name), ['bold', 'italic', 'strike', 'code', 'spoiler']);
      expect(formatButtons.map((b) => b.label), ['Bold', 'Italic', 'Strikethrough', 'Code', 'Spoiler']);
      for (final b in formatButtons) {
        expect(formats.containsKey(b.name), isTrue, reason: b.name);
      }
    });

    test('what each format writes is read back as that format by the message parser', () {
      for (final name in formats.keys) {
        final r = on('say hello now', 'hello', name);
        expect(tokens(r.text).any((t) => isFormat(t, name)), isTrue, reason: '$name: ${r.text}');
      }
    });
  });

  group('wrapping a selection', () {
    test('wrapped in the marks, and the selection stays on the words', () {
      expect(on('say hello now', 'hello', 'bold'), (text: 'say **hello** now', sel: 'hello', start: 6, end: 11));
      expect(on('say hello now', 'hello', 'italic'), (text: 'say _hello_ now', sel: 'hello', start: 5, end: 10));
      expect(on('say hello now', 'hello', 'strike'), (text: 'say ~~hello~~ now', sel: 'hello', start: 6, end: 11));
      expect(on('say hello now', 'hello', 'code'), (text: 'say `hello` now', sel: 'hello', start: 5, end: 10));
      expect(on('say hello now', 'hello', 'spoiler'), (text: 'say ||hello|| now', sel: 'hello', start: 6, end: 11));
    });

    test('the whole text, the start, the end', () {
      expect(run('hello', 0, 5, 'bold').text, '**hello**');
      expect(on('hello world', 'hello', 'bold').text, '**hello** world');
      expect(on('hello world', 'world', 'bold').text, 'hello **world**');
    });

    test('several words, with their spaces between', () {
      expect(on('the ending is ok', 'ending is', 'spoiler'), (text: 'the ||ending is|| ok', sel: 'ending is', start: 6, end: 15));
    });
  });

  group('taking it off', () {
    test('formatting twice in a row (selection kept) takes it off, and off then on is the same as on', () {
      final once = on('say hello now', 'hello', 'bold');
      final twice = run(once.text, once.start, once.end, 'bold');
      expect(twice, (text: 'say hello now', sel: 'hello', start: 4, end: 9));
      expect(run(twice.text, twice.start, twice.end, 'bold'), once);
    });

    test('every format toggles', () {
      for (final name in formats.keys) {
        final once = on('say hello now', 'hello', name);
        final twice = run(once.text, once.start, once.end, name);
        expect(twice.text, 'say hello now', reason: name);
        expect(twice.sel, 'hello', reason: name);
      }
    });

    test('selecting the marks too takes them off', () {
      expect(run('say **hello** now', 4, 13, 'bold'), (text: 'say hello now', sel: 'hello', start: 4, end: 9));
      expect(run('say ||hi|| now', 4, 10, 'spoiler'), (text: 'say hi now', sel: 'hi', start: 4, end: 6));
    });

    test('a different format on formatted words adds to it, and each comes off alone (bold, then italic)', () {
      final bold = on('say hello now', 'hello', 'bold');
      final both = run(bold.text, bold.start, bold.end, 'italic');
      expect(both.text, 'say **_hello_** now');
      expect(both.sel, 'hello');
      expect(run(both.text, both.start, both.end, 'bold'), (text: 'say _hello_ now', sel: 'hello', start: 5, end: 10));
      expect(run(both.text, both.start, both.end, 'italic'), (text: 'say **hello** now', sel: 'hello', start: 6, end: 11));
    });

    test('taking bold off words that are bold and italic, the other way round', () {
      const t = 'say _**hello**_ now';
      final i = t.indexOf('hello');
      final r = run(t, i, i + 5, 'bold');
      expect(r.text, 'say _hello_ now');
      expect(r.sel, 'hello');
    });

    test('through several layers: each comes off alone', () {
      var r = (text: 'say hello now', start: 4, end: 9);
      for (final name in ['bold', 'italic', 'strike', 'spoiler']) {
        final x = applyFormat(r.text, r.start, r.end, name);
        r = (text: x.text, start: x.start, end: x.end);
      }
      expect(r.text, 'say **_~~||hello||~~_** now', reason: 'each new format goes directly around the words, so the first is outermost');
      for (final name in ['bold', 'italic', 'strike', 'spoiler']) {
        final off = run(r.text, r.start, r.end, name);
        expect(off.sel, 'hello', reason: name);
        expect(off.text.contains(formats[name]!.$1), isFalse, reason: '$name gone');
        for (final other in ['bold', 'italic', 'strike', 'spoiler'].where((n) => n != name)) {
          expect(off.text.contains(formats[other]!.$1), isTrue, reason: '$other kept when $name comes off');
        }
      }
    });

    test('a mark of the same kind NOT around the words is not mistaken for theirs', () {
      expect(on('**one** two', 'two', 'bold').text, '**one** **two**');
      expect(on('_a_ b', 'b', 'italic').text, '_a_ _b_');
    });

    test('stepping out through other marks only when they really surround it on both sides', () {
      expect(on('_hello now', 'hello', 'bold').text, '_**hello** now');
      expect(on('hello_ now', 'hello', 'bold').text, '**hello**_ now');
    });

    test('another format with its mark on ONE side only is not a layer to step through', () {
      const t = '**_hello!** now';
      final from = t.indexOf('hello');
      final r = run(t, from, from + 5, 'bold');
      expect(r.text.length, t.length + 4);
      expect(r.text.contains('**hello**'), isTrue, reason: 'just the words are wrapped');
      const u = '**hello_!** now';
      expect(run(u, 2, 7, 'bold').text.length, u.length + 4);
    });
  });

  group('spaces', () {
    test('spaces at the ends of a selection stay outside the marks (a spoiler cannot start or end with one)', () {
      expect(run('say  secret  now', 3, 13, 'spoiler'), (text: 'say  ||secret||  now', sel: 'secret', start: 7, end: 13));
      expect(run(' x ', 0, 3, 'bold'), (text: ' **x** ', sel: 'x', start: 3, end: 4));
    });

    test('and what it writes is a spoiler', () {
      final r = run('say  secret  now', 3, 13, 'spoiler');
      expect(tokens(r.text).any((t) => t is SpoilerToken), isTrue);
    });

    test('a tab or a line break at the end is a space too', () {
      expect(run('hello\t', 0, 6, 'bold').text, '**hello**\t');
      expect(run('hello\n', 0, 6, 'bold').text, '**hello**\n');
    });
  });

  group('nothing selected', () {
    test('the pair of marks goes in at the cursor, the cursor between them', () {
      expect(run('say  now', 4, 4, 'spoiler'), (text: 'say |||| now', sel: '', start: 6, end: 6));
      expect(run('', 0, 0, 'bold'), (text: '****', sel: '', start: 2, end: 2));
      expect(run('abc', 3, 3, 'code'), (text: 'abc``', sel: '', start: 4, end: 4));
      expect(run('abc', 0, 0, 'italic'), (text: '__abc', sel: '', start: 1, end: 1));
    });

    test('between an empty pair, it takes the pair away', () {
      expect(run('say |||| now', 6, 6, 'spoiler'), (text: 'say  now', sel: '', start: 4, end: 4));
      expect(run('****', 2, 2, 'bold'), (text: '', sel: '', start: 0, end: 0));
    });

    test('only spaces selected counts as nothing selected', () {
      expect(run('a   b', 1, 4, 'bold'), (text: 'a   ****b', sel: '', start: 6, end: 6));
    });

    test('a cursor beside a mark, but not between a pair, adds a pair', () {
      expect(run('a**b', 3, 3, 'bold').text, 'a******b');
      expect(run('abc**', 3, 3, 'bold').text, 'abc******', reason: 'before a closing mark with no opening one');
      expect(run('**abc', 2, 2, 'bold').text, '******abc', reason: 'after an opening mark with no closing one');
    });

    test('a selected empty pair is taken away, like the cursor between one', () {
      expect(run('say |||| now', 4, 8, 'spoiler'), (text: 'say  now', sel: '', start: 4, end: 4));
      expect(run('****', 0, 4, 'bold'), (text: '', sel: '', start: 0, end: 0));
    });
  });

  group('marks on one side only: nothing is lost', () {
    test('marks on ONE side of the words are not a pair: the words are wrapped, and nothing is cut', () {
      expect(on('**hello now', 'hello', 'bold'), (text: '****hello** now', sel: 'hello', start: 4, end: 9));
      expect(on('hello** now', 'hello', 'bold'), (text: '**hello**** now', sel: 'hello', start: 2, end: 7));
    });

    test('a selection that starts with the marks but does not end with them is wrapped, not unwrapped', () {
      expect(run('**hello now', 0, 7, 'bold').text, '****hello** now');
      expect(run('say hello** now', 4, 11, 'bold').text, 'say **hello**** now');
    });
  });

  group('several lines', () {
    test('marked line by line, since the marks cannot cross a line break', () {
      final r = run('one\ntwo\nthree', 0, 13, 'italic');
      expect(r.text, '_one_\n_two_\n_three_');
      expect(r.sel, 'one_\n_two_\n_three');
    });

    test('a selection that ends before a line break stops there', () {
      expect(run('hello\nworld', 0, 3, 'bold'), (text: '**hel**lo\nworld', sel: 'hel', start: 2, end: 5));
      expect(run('hello\nworld', 6, 9, 'bold').text, 'hello\n**wor**ld');
    });

    test('a selection that starts after a line break and ends after the next one', () {
      expect(run('ab\ncd\nef', 1, 7, 'bold').text, 'a**b**\n**cd**\n**e**f');
    });

    test('empty lines in between are left empty', () {
      expect(run('one\n\nthree', 0, 10, 'bold').text, '**one**\n\n**three**');
    });

    test('spaces at the ends of each line stay outside', () {
      expect(run(' one \n two ', 0, 11, 'spoiler').text, ' ||one|| \n ||two|| ');
    });

    test('taking it off several lines', () {
      final r = run('_one_\n_two_', 0, 11, 'italic');
      expect(r.text, 'one\ntwo');
      expect(r.sel, 'one\ntwo');
    });

    test('some lines marked and some not: all end up marked, none twice', () {
      expect(run('_one_\ntwo', 0, 9, 'italic').text, '_one_\n_two_');
    });

    test('lines of the selection only: the rest of the text is not touched', () {
      expect(run('keep\nthis\nand that', 5, 9, 'bold').text, 'keep\n**this**\nand that');
    });

    test('what is written line by line is read back as pieces on each line', () {
      final r = run('one\ntwo', 0, 7, 'spoiler');
      final spoilers = [
        for (final b in parseMessage(r.text))
          if (b is ParagraphBlock) ...b.tokens.whereType<SpoilerToken>(),
      ];
      expect(spoilers, hasLength(2));
    });
  });

  group('odd input', () {
    test('a selection given backwards is the same as forwards', () {
      expect(run('say hello now', 9, 4, 'bold'), run('say hello now', 4, 9, 'bold'));
    });

    test('a selection past the end, or before the start, is held to the text', () {
      expect(run('abc', 0, 99, 'bold').text, '**abc**');
      expect(run('abc', -5, 3, 'bold').text, '**abc**');
      expect(run('abc', -1, -1, 'bold').text, '****abc', reason: 'no selection at all (-1): at the start');
    });

    test('a format that does not exist changes nothing', () {
      expect(applyFormat('abc', 1, 2, 'underline'), (text: 'abc', start: 1, end: 2));
      expect(applyFormat('abc', 9, 9, 'nope'), (text: 'abc', start: 3, end: 3));
    });

    test('accents and emoji are one thing each (counted as the text box counts them)', () {
      expect(on('say héllo 😀 now', 'héllo', 'bold').text, 'say **héllo** 😀 now');
      expect(on('say 😀 now', '😀', 'spoiler').text, 'say ||😀|| now');
    });

    test('mentions and links in the selection are wrapped with the rest', () {
      expect(on('hi <@abcdef12> see https://x.test ok', '<@abcdef12>', 'spoiler').text, 'hi ||<@abcdef12>|| see https://x.test ok');
    });

    test('an empty text', () {
      expect(applyFormat('', 0, 0, 'bold'), (text: '****', start: 2, end: 2));
    });
  });
}
