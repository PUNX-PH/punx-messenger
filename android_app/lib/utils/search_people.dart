import '../models/message.dart';
import '../models/user_profile.dart';
import 'fold.dart';

/// A person picker for the search box: while the box ends in `from:` or `mentions:` and a part of a name,
/// the people of this chat who match are offered, and pressing one writes the piece for you. Port of
/// `src/lib/searchPeople.js`.
///
///     from:an   ->  Ana Reyes, Ian Cruz          (press one)  ->  from:"Ana Reyes"

/// The piece being typed at the end of the box: [op] is `from` or `mentions`, [partial] what is typed of
/// the name, [start] where the piece begins.
typedef PersonPiece = ({String op, String partial, int start});

/// A person a piece can name.
typedef Person = ({String uid, String name});

/// What is offered: [value] goes after the colon, [label] is what is shown, [hint] a note beside it.
typedef PersonChoice = ({String value, String label, String? hint});

// A piece being typed at the very end of the box: from:  from:an  from:"Ana R  (a quote not yet closed).
// A piece with its closing quote, or followed by a space, is finished and not matched.
final _openPiece = RegExp(
  r'(^|\s)(from|mentions):("[^"]*|[^\s"]*)$',
  caseSensitive: false,
);

/// The piece being typed at the end of [query], or null.
PersonPiece? openPersonPiece(String? query) {
  final m = _openPiece.firstMatch(query ?? '');
  if (m == null) return null;
  final raw = m.group(3)!;
  return (
    op: m.group(2)!.toLowerCase(),
    partial: raw.startsWith('"') ? raw.substring(1) : raw,
    start: m.start + m.group(1)!.length,
  );
}

/// The people a piece can name in these messages, the one who spoke (or was mentioned) last first:
/// `from:` the authors, `mentions:` the people mentioned. Names are the live ones, or for an author who
/// has gone, the name written on the message. Someone with no name is left out.
List<Person> chatPeople(
  List<ChatMessage> messages,
  Map<String, UserProfile> usersById,
  String op,
) {
  final seen = <String, Person>{};
  for (var i = messages.length - 1; i >= 0; i--) {
    final m = messages[i];
    final uids = op == 'mentions' ? m.mentionedUids : [m.author.uid];
    for (final uid in uids) {
      if (uid.isEmpty || seen.containsKey(uid)) continue;
      final live = usersById[uid]?.name ?? '';
      final name =
          (live.isNotEmpty ? live : (op == 'mentions' ? '' : m.author.name))
              .trim();
      if (name.isNotEmpty) seen[uid] = (uid: uid, name: name);
    }
  }
  return seen.values.toList();
}

final _spaces = RegExp(r'\s+');

/// What to offer for [piece]. "Me" first when you could be meant, then the people whose name holds what was
/// typed, those where a word of the name starts with it before those where it is somewhere inside.
/// Accents and capitals do not matter. At most [limit].
List<PersonChoice> suggestPeople(
  PersonPiece? piece,
  List<Person> people, {
  String? meUid,
  int limit = 6,
}) {
  if (piece == null) return const [];
  final q = foldText(piece.partial).trim();
  final out = <PersonChoice>[];
  if (meUid != null && meUid.isNotEmpty && 'me'.startsWith(q)) {
    out.add((value: 'me', label: 'Me', hint: 'you'));
  }
  final starts = <PersonChoice>[];
  final inside = <PersonChoice>[];
  final taken = {for (final o in out) o.value.toLowerCase()};
  for (final p in people) {
    if (p.uid == meUid) continue; // that is "me"
    final name = foldText(p.name);
    if (!name.contains(q)) continue;
    final item = (value: p.name.replaceAll('"', ''), label: p.name, hint: null);
    // Two people with one name are one choice (the piece names a name, not a person), and so is a person
    // called "Me" next to the "Me" that means you.
    if (!taken.add(item.value.toLowerCase())) continue;
    final atStart =
        name.startsWith(q) || name.split(_spaces).any((w) => w.startsWith(q));
    (atStart ? starts : inside).add(item);
  }
  return [...out, ...starts, ...inside].take(limit).toList();
}

/// The box with the piece being typed replaced by the one chosen (quoted if it has spaces), and a space after it.
String pickPerson(String? query, PersonPiece piece, String value) {
  final v = RegExp(r'\s').hasMatch(value) ? '"$value"' : value;
  final q = query ?? '';
  return '${q.substring(0, piece.start.clamp(0, q.length))}${piece.op}:$v ';
}
