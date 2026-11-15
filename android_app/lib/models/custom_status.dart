// A short custom status next to a person's name ("On leave", "In a meeting"), optionally clearing
// by itself: mirrors src/lib/status.js, and stored in the same place (`status: { text, until }` on
// the person's own `users/{uid}` document), so one set on the web shows on the phone and the other
// way round.
//
// Everything read from somebody else's profile is cleaned again here, not trusted: the rules let a
// person write any text into their own profile, so a status can arrive too long, with control
// characters, as the wrong type, or with text-direction tricks in it.

/// The longest a status may be, in characters.
const int statusMax = 60;

// Control characters, and the marks that make text run right-to-left or flip around it.
final RegExp _unwanted = RegExp(
  r'[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]',
);

/// Text for a status: one line, no control or direction characters, at most [statusMax]
/// characters. '' if nothing is left.
String cleanStatusText(Object? raw) {
  if (raw is! String) return '';
  final flat = raw.replaceAll(_unwanted, ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  return String.fromCharCodes(flat.runes.take(statusMax)).trim();
}

class CustomStatus {
  const CustomStatus({required this.text, this.until});

  final String text;

  /// When it ends, in milliseconds since 1970; null for "until I change it".
  final int? until;

  /// Reads what a profile holds. Null when it is absent, not usable, or has no text left after
  /// cleaning. Safe to call on anybody's profile. Whether it has EXPIRED is decided where it is
  /// shown ([isActiveAt]), so nothing has to run to clear it.
  static CustomStatus? parse(Object? raw) {
    if (raw is! Map) return null;
    final text = cleanStatusText(raw['text']);
    if (text.isEmpty) return null;
    final until = raw['until'];
    return CustomStatus(
      text: text,
      until: until is num && until.isFinite ? until.toInt() : null,
    );
  }

  /// Has it not ended yet at [now]?
  bool isActiveAt(DateTime now) =>
      until == null || until! > now.millisecondsSinceEpoch;
}
