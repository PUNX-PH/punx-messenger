import 'fold.dart';

/// One stretch of a text: either as it is, or a match of what was searched for.
typedef HighlightPart = ({String text, bool match});

/// Cuts [text] into the stretches that match [query] and the ones in between, in order, so that joining
/// them gives back [text]. Capitals and accents do not matter ("cafe" marks "CAFÉ"); the text keeps its
/// own letters. Port of `src/lib/highlight.js`.
///
/// No query (or one that is only marks, which fold to nothing), or no text, is one stretch that does not
/// match.
List<HighlightPart> highlightParts(String text, String query) {
  final q = foldText(query);
  if (text.isEmpty || q.isEmpty) {
    return [(text: text, match: false)];
  }
  final f = foldIndexed(text);
  final parts = <HighlightPart>[];
  var from = 0; // where the next part begins, in the real text
  var i = 0; // where to look, in the folded text
  while (true) {
    final at = f.text.indexOf(q, i);
    if (at < 0) break;
    final start = f.starts[at];
    var end = f.ends[at + q.length - 1];
    // The marks written after the last letter belong to it (they folded to nothing, so are not in `ends`).
    for (final r in text.substring(end).runes) {
      if (!isFoldMark(r)) break;
      end += r > 0xffff ? 2 : 1;
    }
    // A match that begins inside a character the last match already took whole (the second "s" of "ß").
    if (start < from) {
      i = at + 1;
      continue;
    }
    if (start > from) {
      parts.add((text: text.substring(from, start), match: false));
    }
    parts.add((text: text.substring(start, end), match: true));
    from = end;
    i = at + q.length;
  }
  if (from < text.length) parts.add((text: text.substring(from), match: false));
  return parts;
}
