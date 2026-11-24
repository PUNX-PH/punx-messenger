import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/utils/fold.dart';
import 'package:punx_messenger/utils/fold_table.dart';

// Folding text for searching, as the web does it (src/lib/fold.js). test/fixtures/fold_cases.txt is
// generated from the web's own function (scripts/gen-fold-table.mjs): every character it changes.

void main() {
  group('foldText', () {
    test('capitals go', () {
      expect(foldText('Hello WORLD'), 'hello world');
      expect(foldText('MiXeD 123 !?'), 'mixed 123 !?');
    });

    test('accents go, from capitals and small letters alike', () {
      expect(foldText('Café'), 'cafe');
      expect(foldText('JOSÉ'), 'jose');
      expect(foldText('Ñandú'), 'nandu');
      expect(foldText('crème brûlée'), 'creme brulee');
      expect(foldText('Zoë Ångström'), 'zoe angstrom');
      expect(foldText('Łódź Đà Nẵng'), 'lodz da nang');
    });

    test('letters that are not a letter and a mark: written the plain way', () {
      expect(foldText('Straße'), 'strasse');
      expect(foldText('Æon œuvre'), 'aeon oeuvre');
      expect(foldText('Øresund'), 'oresund');
      expect(foldText('ıI'), 'ii');
    });

    test(
      'a letter and its mark written as two characters folds the same as the one-character form',
      () {
        expect(foldText('é'), 'e');
        expect(foldText('é'), 'e');
        expect(
          foldText(
            'caf'
            'é',
          ),
          foldText('café'),
        );
      },
    );

    test('a mark on its own folds to nothing', () {
      expect(foldText('́'), '');
      expect(foldText('á̂b'), 'ab');
    });

    test(
      'other alphabets keep their letters, and are only made lower case',
      () {
        expect(foldText('ПРИВЕТ'), 'привет');
        expect(foldText('東京'), '東京');
        expect(foldText('Ελλάδα'), 'ελλαδα');
        expect(foldText('👍 ok'), '👍 ok');
      },
    );

    test('Korean syllables stay as they are', () {
      expect(foldText('한국어'), '한국어');
      expect(foldIndexed('한국').starts, [0, 1]);
    });

    test('a Greek sigma is the same at the end of a word and elsewhere', () {
      expect(foldText('ΟΔΟΣ'), foldText('οδοσ'));
      expect(foldText('οδος'), foldText('οδοσ'));
    });

    test('nothing is empty', () {
      expect(foldText(''), '');
      expect(foldText(null), '');
    });

    test(
      'every character the web changes folds to the same here (all of them, from the generated list)',
      () {
        final lines = File('test/fixtures/fold_cases.txt')
            .readAsLinesSync()
            .where((l) => l.isNotEmpty && !l.startsWith('#'))
            .toList();
        expect(lines.length, greaterThan(5000), reason: 'the list was read');
        final changed = <int>{};
        for (final line in lines) {
          final parts = line.split('\t');
          final cp = int.parse(parts[0], radix: 16);
          final expected = parts[1] == 'none'
              ? ''
              : String.fromCharCodes(
                  parts[1].split(' ').map((h) => int.parse(h, radix: 16)),
                );
          final ch = String.fromCharCode(cp);
          expect(foldText(ch), expected, reason: 'U+${cp.toRadixString(16)}');
          expect(
            foldIndexed(ch).text,
            expected,
            reason: 'indexed U+${cp.toRadixString(16)}',
          );
          changed.add(cp);
        }
        expect(changed.contains(0xe9), isTrue);
        expect(changed.contains(0xdf), isTrue);
      },
    );

    test('and every character the web leaves alone stays as it is here', () {
      final changed = <int>{
        for (final line in File(
          'test/fixtures/fold_cases.txt',
        ).readAsLinesSync())
          if (line.isNotEmpty && !line.startsWith('#'))
            int.parse(line.split('\t')[0], radix: 16),
      };
      for (var cp = 0; cp <= 0x10ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        if (changed.contains(cp)) continue;
        final ch = String.fromCharCode(cp);
        if (foldText(ch) != ch) {
          fail('U+${cp.toRadixString(16)} changes here and not on the web');
        }
      }
    });
  });

  group('foldIndexed', () {
    test('gives the same text as foldText, for every kind of input', () {
      for (final t in [
        '',
        'abc',
        'Café',
        'Straße',
        'éx',
        '́',
        'ΟΔΟΣ',
        '👍a👍',
        'Æ Ø Đ',
        'ПРИВЕТ',
      ]) {
        expect(foldIndexed(t).text, foldText(t), reason: t);
      }
    });

    test('says where each letter came from', () {
      var r = foldIndexed('ab');
      expect(r.text, 'ab');
      expect(r.starts, [0, 1]);
      expect(r.ends, [1, 2]);
      r = foldIndexed('a\u00dfb'); // ß gives two letters from one character
      expect(r.text, 'assb');
      expect(r.starts, [0, 1, 1, 2]);
      expect(r.ends, [1, 2, 2, 3]);
      r = foldIndexed('e\u0301x'); // the mark on its own gives none
      expect(r.text, 'ex');
      expect(r.starts, [0, 2]);
      expect(r.ends, [1, 3]);
    });

    test('counts an emoji (two code units) as one character', () {
      final r = foldIndexed('a👍b');
      expect(r.text, 'a👍b');
      expect(r.starts, [0, 1, 1, 3]);
      expect(r.ends, [1, 3, 3, 4]);
    });
  });

  group('isFoldMark', () {
    test('is true for marks and only for them', () {
      for (final cp in [
        0x300,
        0x301,
        0x36f,
        0x483,
        0x64b,
        0x20d0,
        0xfe20,
        0x1d165,
      ]) {
        expect(isFoldMark(cp), isTrue, reason: cp.toRadixString(16));
      }
      for (final cp in [0x41, 0x61, 0x2ff, 0x370, 0xe9, 0x20, 0x1f44d]) {
        expect(isFoldMark(cp), isFalse, reason: cp.toRadixString(16));
      }
    });
  });

  group('the table', () {
    test('is sorted and in pairs, so the search for a mark can work', () {
      expect(foldMarkRanges.length.isEven, isTrue);
      for (var i = 0; i < foldMarkRanges.length; i += 2) {
        expect(foldMarkRanges[i] <= foldMarkRanges[i + 1], isTrue);
        if (i >= 2) {
          expect(foldMarkRanges[i], greaterThan(foldMarkRanges[i - 1]));
        }
      }
    });

    test('has no ASCII and no mark, and every entry changes its character', () {
      for (final MapEntry(key: cp, value: to) in foldTable.entries) {
        expect(cp, greaterThanOrEqualTo(0x80));
        expect(to, isNot(String.fromCharCode(cp)));
        expect(isFoldMark(cp), isFalse);
      }
    });
  });
}
