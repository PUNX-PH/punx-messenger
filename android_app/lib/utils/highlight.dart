/// One stretch of a text: either as it is, or a match of what was searched for.
typedef HighlightPart = ({String text, bool match});

/// Cuts [text] into the stretches that match [query] (ignoring upper and lower case) and the ones in
/// between, in order, so that joining them gives back [text]. Port of `highlight()` in
/// `src/components/SearchDropdown.jsx`.
///
/// No query, or no text, is one stretch that does not match. (The positions found in the lower-cased
/// text are used in the real one: in Dart no character changes its length when lower-cased, checked
/// over every code point, unlike in JavaScript where the dotted capital I does.)
List<HighlightPart> highlightParts(String text, String query) {
  if (text.isEmpty || query.isEmpty) {
    return [(text: text, match: false)];
  }
  final lower = text.toLowerCase();
  final q = query.toLowerCase();
  final parts = <HighlightPart>[];
  var i = 0;
  while (i < text.length) {
    final at = lower.indexOf(q, i);
    if (at < 0) {
      parts.add((text: text.substring(i), match: false));
      break;
    }
    if (at > i) parts.add((text: text.substring(i, at), match: false));
    parts.add((text: text.substring(at, at + query.length), match: true));
    i = at + query.length;
  }
  return parts;
}
