import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/channel.dart';
import '../models/dm_convo.dart';
import '../models/group.dart';
import '../models/user_profile.dart';
import 'firestore_paths.dart';

// Where a message can be forwarded to, and how a typed query ranks the choices. Mirrors the parts
// of src/lib/quickSwitch.js (buildTargets, rankTargets) and src/lib/forward.js (destinationPath,
// forwardTargets) that the web's Forward box uses, in one place. Pure, so the ranking (the part
// people feel) is tested.

enum TargetKind { notes, dm, channel }

class ForwardTarget {
  const ForwardTarget({
    required this.id,
    required this.kind,
    required this.label,
    required this.hint,
    required this.path,
    this.unread = false,
    this.at = 0,
    this.user,
  });

  final String id;
  final TargetKind kind;
  final String label;

  /// A person's email, a channel's group, "Private to you" for the notes.
  final String hint;

  /// The messages collection a message to this destination goes into.
  final String path;
  final bool unread;

  /// Milliseconds of the newest activity there, 0 when there is none.
  final int at;

  /// For a person: who, so a conversation can be made if there is none yet.
  final UserProfile? user;
}

/// Where it went, in the note that says so: "your notes", "#general", "Ana Reyes".
String forwardedToName(ForwardTarget t) => switch (t.kind) {
  TargetKind.notes => 'your notes',
  TargetKind.channel => '#${t.label}',
  TargetKind.dm => t.label,
};

int _ms(Timestamp? t) => t?.millisecondsSinceEpoch ?? 0;

/// The destinations to offer: your notes, people and text channels, without voice rooms and
/// without the conversation the message is already in ([currentPath] is that conversation's
/// messages path).
List<ForwardTarget> buildForwardTargets({
  required String meUid,
  required List<UserProfile> users,
  required Map<String, DmConvo> convosByOther,
  required List<Group> groups,
  required Map<String, List<Channel>> channelsByGroup,
  required Map<String, Timestamp> lastRead,
  required Set<String> mutedGroups,
  required Set<String> mutedChats,
  String? currentPath,
}) {
  final out = <ForwardTarget>[
    ForwardTarget(
      id: 'notes',
      kind: TargetKind.notes,
      label: 'My Notes',
      hint: 'Private to you',
      path: 'users/$meUid/notes',
    ),
  ];

  for (final u in users) {
    if (u.id == meUid) continue;
    final convo = convosByOther[u.id];
    final dmKey = convo == null ? null : pathToReadKey('dms/${convo.id}');
    final unread =
        convo != null &&
        convo.lastMessageAuthorUid != null &&
        convo.lastMessageAuthorUid != meUid &&
        !mutedChats.contains(dmKey) &&
        isUnread(convo.lastMessageAt, lastRead[dmKey]);
    out.add(
      ForwardTarget(
        id: 'dm:${u.id}',
        kind: TargetKind.dm,
        label: u.name.isNotEmpty
            ? u.name
            : (u.email.isNotEmpty ? u.email : 'Unknown'),
        hint: u.email,
        path: 'dms/${dmConvoId(meUid, u.id)}/messages',
        unread: unread,
        at: _ms(convo?.lastMessageAt),
        user: u,
      ),
    );
  }

  for (final g in groups) {
    for (final c in channelsByGroup[g.id] ?? const <Channel>[]) {
      // A voice room has no messages to forward into.
      if (c.type == 'voice') continue;
      final key = pathToReadKey('groups/${g.id}/channels/${c.id}');
      final unread =
          !mutedGroups.contains(g.id) &&
          !mutedChats.contains(key) &&
          isUnread(c.lastMessageAt, lastRead[key]);
      out.add(
        ForwardTarget(
          id: 'ch:${g.id}:${c.id}',
          kind: TargetKind.channel,
          label: c.name.isNotEmpty ? c.name : 'channel',
          hint: g.name,
          path: 'groups/${g.id}/channels/${c.id}/messages',
          unread: unread,
          at: _ms(c.lastMessageAt),
        ),
      );
    }
  }

  return out.where((t) => t.path != currentPath).toList();
}

// Common Latin letters with accents, to the plain letter: "Zoe" is found by "zoe". (The web strips
// every combining mark; this covers the letters names are written with in Latin script.)
const _accents = {
  'a': 'àáâãäåāăą',
  'c': 'çćčĉċ',
  'd': 'ďđ',
  'e': 'èéêëēĕėęě',
  'g': 'ĝğġģ',
  'h': 'ĥħ',
  'i': 'ìíîïĩīĭįı',
  'j': 'ĵ',
  'k': 'ķ',
  'l': 'ĺļľŀł',
  'n': 'ñńņňŉ',
  'o': 'òóôõöøōŏő',
  'r': 'ŕŗř',
  's': 'śŝşš',
  't': 'ţťŧ',
  'u': 'ùúûüũūŭůűų',
  'w': 'ŵ',
  'y': 'ýÿŷ',
  'z': 'źżž',
};
final Map<int, String> _plain = {
  for (final e in _accents.entries)
    for (final r in e.value.runes) r: e.key,
};

/// Lower-case, accents removed: "Zoë" is found by "zoe".
String normalizeForSearch(String s) {
  final b = StringBuffer();
  for (final r in s.toLowerCase().runes) {
    b.write(_plain[r] ?? String.fromCharCode(r));
  }
  return b.toString();
}

final RegExp _wordBreak = RegExp(r'[\s\-_./]+');
final RegExp _isBreak = RegExp(r'[\s\-_./]');

// One word of the query against one target: how well, or 0 for not at all.
int _scoreToken(String token, String label, String hint) {
  final words = label.split(_wordBreak).where((w) => w.isNotEmpty);
  if (label.startsWith(token)) return 100;
  if (words.any((w) => w.startsWith(token))) return 80;
  if (label.contains(token)) return 60;
  if (hint.contains(token)) return 40;
  // Letters in order, starting at the beginning of a word: "mkt" finds "marketing". (Starting
  // anywhere let "ana" find "brand-assets" by picking letters out of it.)
  bool startsAt(int from) {
    var i = 0;
    for (var k = from; k < label.length && i < token.length; k++) {
      if (label[k] == token[i]) i++;
    }
    return i == token.length;
  }

  for (var k = 0; k < label.length; k++) {
    final atWordStart = k == 0 || _isBreak.hasMatch(label[k - 1]);
    if (atWordStart && label[k] == token[0] && startsAt(k)) return 20;
  }
  return 0;
}

/// Newest activity first; the name breaks a tie.
int _byRecency(ForwardTarget a, ForwardTarget b) {
  final byTime = b.at.compareTo(a.at);
  return byTime != 0
      ? byTime
      : a.label.toLowerCase().compareTo(b.label.toLowerCase());
}

/// The targets for a query, best first. Every word must match (name, or the group a channel is
/// in, or the letters in order). Names that start with the word beat words inside them, which beat
/// the middle of a word. Unread conversations rise. A leading "#" means channels only and "@"
/// means people only. With nothing typed: what is unread, then what was active most recently.
List<ForwardTarget> rankForwardTargets(
  List<ForwardTarget> targets,
  String query, {
  int limit = 20,
}) {
  var q = normalizeForSearch(query).trim();
  Set<TargetKind>? only;
  if (q.startsWith('#')) {
    only = {TargetKind.channel};
    q = q.substring(1).trim();
  } else if (q.startsWith('@')) {
    only = {TargetKind.dm};
    q = q.substring(1).trim();
  }
  final pool = only == null
      ? targets
      : targets.where((t) => only!.contains(t.kind)).toList();

  if (q.isEmpty) {
    final sorted = [...pool]
      ..sort((a, b) {
        final u = (b.unread ? 1 : 0) - (a.unread ? 1 : 0);
        return u != 0 ? u : _byRecency(a, b);
      });
    return sorted.take(limit).toList();
  }

  final tokens = q.split(RegExp(r'\s+'));
  final scored = <({ForwardTarget t, int score})>[];
  for (final t in pool) {
    final label = normalizeForSearch(t.label);
    final hint = normalizeForSearch(t.hint);
    var total = 0;
    for (final token in tokens) {
      final s = _scoreToken(token, label, hint);
      if (s == 0) {
        total = 0;
        break;
      }
      total += s;
    }
    if (total > 0) scored.add((t: t, score: total + (t.unread ? 15 : 0)));
  }
  scored.sort((a, b) {
    final s = b.score.compareTo(a.score);
    return s != 0 ? s : _byRecency(a.t, b.t);
  });
  return scored.take(limit).map((x) => x.t).toList();
}

/// One line of what is being forwarded, for the box (mentions as names, as they will be sent):
/// the text on one line cut at [max] characters with an ellipsis, else what the message carries.
String forwardPreviewLine(String text, {required bool hasVoice, int max = 160}) {
  final flat = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  final runes = flat.runes.toList();
  final shown = String.fromCharCodes(runes.take(max));
  if (shown.isEmpty) return hasVoice ? '[voice message]' : '[image]';
  return runes.length > max ? '$shown…' : shown;
}
