import 'fold_table.dart';

/// Folding text for searching: no capitals and no accents, so "cafe" finds "Café", "jose" finds "José",
/// "strasse" finds "Straße". Port of `src/lib/fold.js`; what the web changes is in `fold_table.dart`
/// (generated from it, so the two cannot drift: `scripts/gen-fold-table.mjs`).
///
/// Done one character at a time, so the result never depends on the letters around it and a place in
/// the folded text can be turned back into a place in the real one ([foldIndexed]).

/// A text folded, with where each folded letter came from: `starts[i]` and `ends[i]` are the place in
/// the real text where the character that folded into letter `i` begins and ends (in UTF-16 units, as
/// Dart counts). One character can give several letters ("ß" gives "ss"), none (a mark on its own), or one.
class Folded {
  const Folded(this.text, this.starts, this.ends);

  final String text;
  final List<int> starts;
  final List<int> ends;
}

/// Is this code point a mark (an accent written as a character of its own)? Marks fold to nothing.
bool isFoldMark(int rune) {
  var lo = 0;
  var hi = foldMarkRanges.length ~/ 2 - 1;
  while (lo <= hi) {
    final mid = (lo + hi) >> 1;
    if (rune < foldMarkRanges[mid * 2]) {
      hi = mid - 1;
    } else if (rune > foldMarkRanges[mid * 2 + 1]) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

// One character, folded.
String _foldRune(int rune) {
  if (rune < 0x80) {
    return String.fromCharCode(
      rune >= 0x41 && rune <= 0x5a ? rune + 0x20 : rune,
    );
  }
  // Not Dart's own toLowerCase: its Unicode data is older than the web's, so the table has every character
  // the web changes, capitals too.
  if (isFoldMark(rune)) return '';
  return foldTable[rune] ?? String.fromCharCode(rune);
}

bool _ascii(String s) {
  for (var i = 0; i < s.length; i++) {
    if (s.codeUnitAt(i) >= 0x80) return false;
  }
  return true;
}

/// The text without capitals and without accents.
String foldText(String? text) {
  final s = text ?? '';
  if (_ascii(s)) return s.toLowerCase();
  final out = StringBuffer();
  for (final r in s.runes) {
    out.write(_foldRune(r));
  }
  return out.toString();
}

/// [foldText] with where each letter came from.
Folded foldIndexed(String? text) {
  final s = text ?? '';
  final folded = StringBuffer();
  final starts = <int>[];
  final ends = <int>[];
  var at = 0;
  for (final r in s.runes) {
    final f = _foldRune(r);
    final width = r > 0xffff ? 2 : 1;
    for (var i = 0; i < f.length; i++) {
      starts.add(at);
      ends.add(at + width);
    }
    folded.write(f);
    at += width;
  }
  return Folded(folded.toString(), starts, ends);
}
