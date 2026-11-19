// Formatting what is selected in the message box: **bold**, _italic_, ~~strike~~, `code`, ||spoiler||.
// Mirrors src/lib/formatting.js, case by case.
//
// Pure, so it can be tested: it takes the text and the selection and gives back the new text and the
// new selection. The box only puts the answer on screen.
//
// - Pressing it again on what is already formatted takes the formatting off.
// - With nothing selected it puts the pair of marks at the cursor, the cursor between them; pressing
//   it again between an empty pair takes the pair away.
// - Spaces at the ends of a selection stay OUTSIDE the marks: "** bold**" and "|| secret||" are not
//   bold and not a spoiler, so selecting " secret " gives " ||secret|| ".
// - The marks cannot cross a line break (a message's bold, italic and spoiler end at the end of a
//   line), so a selection of several lines is marked line by line.
// - Italic uses _ and not *, so it can never be mistaken for half of a **bold**.

/// The marks each format puts before and after the words.
const formats = <String, (String, String)>{
  'bold': ('**', '**'),
  'italic': ('_', '_'),
  'strike': ('~~', '~~'),
  'code': ('`', '`'),
  'spoiler': ('||', '||'),
};

/// The formats, in the order the buttons are shown, with the words for each.
const formatButtons = <({String name, String label})>[
  (name: 'bold', label: 'Bold'),
  (name: 'italic', label: 'Italic'),
  (name: 'strike', label: 'Strikethrough'),
  (name: 'code', label: 'Code'),
  (name: 'spoiler', label: 'Spoiler'),
];

/// The new text and the new selection [start, end): on the formatted words, not on the marks.
typedef Formatted = ({String text, int start, int end});

final _space = RegExp(r'\s');
bool _isSpace(String ch) => _space.hasMatch(ch);

/// Is a piece already marked? Three answers: [inside] (the piece is the marks and the words, as when the
/// marks were selected too), the marks AROUND it, perhaps with other formats' marks between ("**_words_**"
/// is bold with the words italic inside it: the bold's marks are at from - 2 and to), or none.
class _Marked {
  const _Marked.inside() : inside = true, from = 0, to = 0;
  const _Marked.outside(this.from, this.to) : inside = false;
  final bool inside;
  final int from;
  final int to;
}

String _slice(String s, int from, int to) =>
    s.substring(from.clamp(0, s.length), to.clamp(0, s.length));

_Marked? _markedAt(String text, int a, int b, String open, String close) {
  final inner =
      b - a >= open.length + close.length &&
      _slice(text, a, a + open.length) == open &&
      _slice(text, b - close.length, b) == close;
  if (inner) return const _Marked.inside();
  var from = a;
  var to = b;
  for (;;) {
    if (_slice(text, from - open.length, from) == open &&
        _slice(text, to, to + close.length) == close) {
      return _Marked.outside(from, to);
    }
    // Step out through the marks of some other format that surround it, and look again.
    (String, String)? step;
    for (final f in formats.values) {
      if (_slice(text, from - f.$1.length, from) == f.$1 &&
          _slice(text, to, to + f.$2.length) == f.$2) {
        step = f;
        break;
      }
    }
    if (step == null) return null;
    from -= step.$1.length;
    to += step.$2.length;
  }
}

/// Formats the selection [start, end) of [text] with [name] (one of [formats]). A format that does not
/// exist changes nothing.
Formatted applyFormat(String text, int start, int end, String name) {
  final marks = formats[name];
  if (marks == null) {
    return (
      text: text,
      start: start.clamp(0, text.length),
      end: end.clamp(0, text.length),
    );
  }
  final (open, close) = marks;
  var s = start.clamp(0, text.length);
  var e = end.clamp(0, text.length);
  if (s > e) (s, e) = (e, s);

  // Lines of the selection, each trimmed of spaces: [from, to) pairs, empty lines left out.
  final pieces = <(int, int)>[];
  var at = s;
  while (at < e) {
    var lineEnd = text.indexOf('\n', at);
    if (lineEnd == -1 || lineEnd > e) lineEnd = e;
    var a = at;
    var b = lineEnd;
    while (a < b && _isSpace(text[a])) {
      a++;
    }
    while (b > a && _isSpace(text[b - 1])) {
      b--;
    }
    if (b > a) pieces.add((a, b));
    at = lineEnd + 1;
  }

  // Nothing but spaces (or nothing) selected: work at the cursor.
  if (pieces.isEmpty) {
    final caret = e;
    final between =
        _slice(text, caret - open.length, caret) == open &&
        _slice(text, caret, caret + close.length) == close;
    if (between) {
      final from = caret - open.length;
      return (
        text: text.substring(0, from) + text.substring(caret + close.length),
        start: from,
        end: from,
      );
    }
    final next = text.substring(0, caret) + open + close + text.substring(caret);
    final pos = caret + open.length;
    return (text: next, start: pos, end: pos);
  }

  final states = [for (final (a, b) in pieces) _markedAt(text, a, b, open, close)];
  final allMarked = states.every((m) => m != null);

  // Built forward in one pass: what lies between the pieces is copied, and each piece is wrapped, or
  // unwrapped (when every piece already has its marks), or left as it is (a marked piece among
  // unmarked ones). The new selection runs from the first piece's words to the last one's.
  final out = StringBuffer();
  var cursor = 0;
  var newStart = 0;
  var newEnd = 0;
  for (var i = 0; i < pieces.length; i++) {
    final (a, b) = pieces[i];
    final state = states[i];
    if (allMarked && !state!.inside) {
      // The marks are around the piece, perhaps outside other formats' marks: take just these away.
      out.write(text.substring(cursor, state.from - open.length));
      out.write(text.substring(state.from, a));
      if (i == 0) newStart = out.length;
      out.write(text.substring(a, b));
      newEnd = out.length;
      out.write(text.substring(b, state.to));
      cursor = state.to + close.length;
    } else if (allMarked) {
      // The marks are inside the piece.
      out.write(text.substring(cursor, a));
      if (i == 0) newStart = out.length;
      out.write(text.substring(a + open.length, b - close.length));
      newEnd = out.length;
      cursor = b;
    } else if (state == null) {
      out.write(text.substring(cursor, a) + open);
      if (i == 0) newStart = out.length;
      out.write(text.substring(a, b));
      newEnd = out.length;
      out.write(close);
      cursor = b;
    } else {
      out.write(text.substring(cursor, a));
      if (i == 0) newStart = out.length;
      out.write(text.substring(a, b));
      newEnd = out.length;
      cursor = b;
    }
  }
  out.write(text.substring(cursor));
  return (text: out.toString(), start: newStart, end: newEnd);
}
