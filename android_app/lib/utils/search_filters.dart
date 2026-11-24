import '../models/message.dart';
import '../models/user_profile.dart';
import 'constants.dart';
import 'fold.dart';

// Search with filters. Mirrors src/lib/searchFilters.js: words and `operator:value` pieces can be
// mixed in one box.
//
//   from:ana            written by someone whose name contains "ana"  (from:me: written by you)
//   mentions:ana        mentions that person                          (mentions:me: mentions you)
//   has:image           has a picture   (also: voice, link, reply)
//   is:pinned           is pinned       (also: edited)
//   before:2026-11-01   sent on a day before that one
//   after:2026-11-01    sent on a day after that one
//   on:2026-11-01       sent on that day
//
// A value with spaces goes in quotes: from:"Ana Reyes". Different filters all have to hold; the same
// filter given twice is an "or" for from: and mentions: ("from:ana from:ben") and an "and" for has:.
// Whatever is left over is the words to look for. Days are in the reader's own time zone.
//
// Only the messages that are loaded are searched, newest first.

const hasValues = ['image', 'voice', 'link', 'reply'];
const isValues = ['pinned', 'edited'];

/// The pieces the box offers as one-press toggles, in this order.
const searchChips = <({String token, String label})>[
  (token: 'has:image', label: 'Pictures'),
  (token: 'has:voice', label: 'Voice'),
  (token: 'has:link', label: 'Links'),
  (token: 'has:reply', label: 'Replies'),
  (token: 'is:pinned', label: 'Pinned'),
];

// An operator is only one at the start of a word, so "https://x" and "re:hi" stay words.
final _operator = RegExp(
  r'(^|\s)(from|mentions|has|is|before|after|on):("[^"]*"|\S*)',
  caseSensitive: false,
);

/// A query taken apart. [before], [after] and [on] are the start of a day (local time) or null;
/// [problems] are sentences about pieces that could not be used (they are left out of the search,
/// not turned into words).
class SearchQuery {
  const SearchQuery({
    this.text = '',
    this.from = const [],
    this.mentions = const [],
    this.has = const [],
    this.flags = const [],
    this.before,
    this.after,
    this.on,
    this.problems = const [],
  });

  /// The words left once every filter is taken out.
  final String text;
  final List<String> from;
  final List<String> mentions;
  final List<String> has;

  /// The `is:` filters (named so, because `is` is a word in Dart).
  final List<String> flags;
  final DateTime? before;
  final DateTime? after;
  final DateTime? on;
  final List<String> problems;

  /// Is there anything to narrow the search other than words?
  bool get hasFilters =>
      from.isNotEmpty ||
      mentions.isNotEmpty ||
      has.isNotEmpty ||
      flags.isNotEmpty ||
      before != null ||
      after != null ||
      on != null;
}

/// A day written 2026-11-01 as the start of that day (local time), or null if it is not a real day.
DateTime? parseDay(String? s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch((s ?? '').trim());
  if (m == null) return null;
  final y = int.parse(m[1]!);
  final mo = int.parse(m[2]!);
  final d = int.parse(m[3]!);
  // The web reads a year before 100 as 19xx and so turns it down; so does this.
  if (y < 100) return null;
  final t = DateTime(y, mo, d);
  // A month or day that does not exist rolls over into the next one (month 13 is next January, the
  // 30th of February is the 2nd of March), which changes the year or the day: so these two are enough.
  if (t.year != y || t.day != d) return null;
  return t;
}

DateTime _nextDay(DateTime d) => DateTime(d.year, d.month, d.day + 1);

/// Takes a query apart. A piece with nothing after the colon yet ("from:") is ignored: it is being
/// typed.
SearchQuery parseSearch(String? query) {
  final from = <String>[];
  final mentions = <String>[];
  final has = <String>[];
  final flags = <String>[];
  final problems = <String>[];
  DateTime? before, after, on;

  void add(List<String> list, String v) {
    if (!list.contains(v)) list.add(v);
  }

  void apply(String key, String value) {
    final v = value.toLowerCase();
    switch (key) {
      case 'from':
        add(from, v);
      case 'mentions':
        add(mentions, v);
      case 'has':
        if (!hasValues.contains(v)) {
          problems.add(
            '"has:$value" is not something to look for (try ${hasValues.join(', ')}).',
          );
        } else {
          add(has, v);
        }
      case 'is':
        if (!isValues.contains(v)) {
          problems.add(
            '"is:$value" is not something to look for (try ${isValues.join(', ')}).',
          );
        } else {
          add(flags, v);
        }
      default:
        final day = parseDay(value);
        if (day == null) {
          problems.add('"$key:$value" is not a day (write it like 2026-11-01).');
        } else if (key == 'before') {
          before = day;
        } else if (key == 'after') {
          after = day;
        } else {
          on = day;
        }
    }
  }

  // (The words either side of a piece were already apart by a space, and the spaces are tidied below.)
  final rest = (query ?? '').replaceAllMapped(_operator, (m) {
    final value = m[3]!.replaceAll(RegExp(r'^"|"$'), '').trim();
    if (value.isNotEmpty) apply(m[2]!.toLowerCase(), value);
    return '';
  });

  return SearchQuery(
    text: rest.replaceAll(RegExp(r'\s+'), ' ').trim(),
    from: from,
    mentions: mentions,
    has: has,
    flags: flags,
    before: before,
    after: after,
    on: on,
    problems: problems,
  );
}

final _link = RegExp(r'https?://\S+', caseSensitive: false);

String _authorName(ChatMessage m, Map<String, UserProfile> usersById) {
  final live = usersById[m.author.uid]?.name ?? '';
  return live.isNotEmpty ? live : m.author.name;
}

bool _isMe(String? meUid, String uid) => meUid != null && meUid.isNotEmpty && uid == meUid;

/// Does this message pass every filter in [p]? [usersById] and [meUid] say who people are.
bool messageMatches(
  ChatMessage m,
  SearchQuery p, {
  Map<String, UserProfile> usersById = const {},
  String? meUid,
}) {
  // Capitals and accents never matter: "cafe" finds "Café", from:jose finds José.
  if (p.text.isNotEmpty && !foldText(m.text).contains(foldText(p.text))) {
    return false;
  }

  if (p.from.isNotEmpty) {
    final name = foldText(_authorName(m, usersById));
    if (!p.from.any((v) => v == 'me' ? _isMe(meUid, m.author.uid) : name.contains(foldText(v)))) {
      return false;
    }
  }
  if (p.mentions.isNotEmpty) {
    bool hit(String v) => v == 'me'
        ? meUid != null && meUid.isNotEmpty && m.mentionedUids.contains(meUid)
        : m.mentionedUids.any(
            (uid) => foldText(usersById[uid]?.name).contains(foldText(v)),
          );
    if (!p.mentions.any(hit)) return false;
  }
  for (final h in p.has) {
    if (h == 'image' && m.imageURL == null) return false;
    if (h == 'voice' && m.voice == null) return false;
    if (h == 'link' && !_link.hasMatch(m.text)) return false;
    if (h == 'reply' && (m.replyTo == null || m.replyTo!.messageId.isEmpty)) {
      return false;
    }
  }
  for (final f in p.flags) {
    if (f == 'pinned' && !m.pinned) return false;
    if (f == 'edited' && m.editedAt == null) return false;
  }
  if (p.before != null || p.after != null || p.on != null) {
    final ms = m.createdAt?.millisecondsSinceEpoch;
    if (ms == null) return false; // not sent yet: no day to compare
    if (p.before != null && !(ms < p.before!.millisecondsSinceEpoch)) return false;
    if (p.after != null && !(ms >= _nextDay(p.after!).millisecondsSinceEpoch)) {
      return false;
    }
    if (p.on != null &&
        !(ms >= p.on!.millisecondsSinceEpoch &&
            ms < _nextDay(p.on!).millisecondsSinceEpoch)) {
      return false;
    }
  }
  return true;
}

/// Searches [messages] (oldest first, as the chat has them) for [query]. Returns the matches newest
/// first (at most [limit]), the query taken apart, and whether there was anything to search for
/// (words or a filter) at all.
({List<ChatMessage> results, SearchQuery parsed, bool active}) searchMessages(
  List<ChatMessage> messages,
  String query, {
  Map<String, UserProfile> usersById = const {},
  String? meUid,
  int limit = AppTiming.searchResultCap,
}) {
  final parsed = parseSearch(query);
  final active = parsed.text.isNotEmpty || parsed.hasFilters;
  if (!active) return (results: const <ChatMessage>[], parsed: parsed, active: false);
  final results = <ChatMessage>[];
  for (var i = messages.length - 1; i >= 0 && results.length < limit; i--) {
    if (messageMatches(messages[i], parsed, usersById: usersById, meUid: meUid)) {
      results.add(messages[i]);
    }
  }
  return (results: results, parsed: parsed, active: true);
}

List<String> _wordsOf(String? q) =>
    (q ?? '').split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();

bool _sameToken(String a, String b) => a.toLowerCase() == b.toLowerCase();

/// Is [token] (like "has:image") one of the words in the box?
bool hasToken(String? query, String token) =>
    _wordsOf(query).any((w) => _sameToken(w, token));

/// Puts [token] in the box, or takes it out if it is there: what a filter button does.
String toggleToken(String? query, String token) {
  final words = _wordsOf(query);
  if (words.any((w) => _sameToken(w, token))) {
    return words.where((w) => !_sameToken(w, token)).join(' ');
  }
  return [...words, token].join(' ');
}
