import '../models/user_profile.dart';

final _mentionExtractRe = RegExp(r'<@([A-Za-z0-9_-]{6,40})>');

/// Extract all mentioned uids from message text — 1:1 port of
/// markdown.jsx's extractMentionedUids().
List<String> extractMentionedUids(String? text) {
  if (text == null || text.isEmpty) return const [];
  final seen = <String>{};
  for (final m in _mentionExtractRe.allMatches(text)) {
    final uid = m.group(1);
    if (uid != null) seen.add(uid);
  }
  return seen.toList();
}

/// Does this message text mention the given uid?
bool mentionsUid(String? text, String? uid) {
  if (uid == null || uid.isEmpty || text == null) return false;
  return text.contains('<@$uid>');
}

/// Converts visible "@Name" mentions in composer text into their `<@uid>`
/// storage tokens — 1:1 port of markdown.jsx's resolveMentions().
///
/// `hintMap` (exact chunk "@Name" -> uid) is populated when the user picks a
/// name from the composer's autocomplete dropdown and is applied first so
/// intentional picks always win over the name-matching fallback below, which
/// handles "@Name" typed manually without autocomplete (matched longest-name
/// first, so "@Al" doesn't win over "@Alice" when both exist).
String resolveMentions(
  String text,
  List<UserProfile> users, [
  Map<String, String>? hintMap,
]) {
  if (text.isEmpty) return text;
  var out = text;

  if (hintMap != null && hintMap.isNotEmpty) {
    for (final entry in hintMap.entries) {
      if (entry.key.isEmpty) continue;
      out = out.replaceAll(entry.key, '<@${entry.value}>');
    }
  }

  final sorted = users.where((u) => u.name.isNotEmpty).toList()
    ..sort((a, b) => b.name.length.compareTo(a.name.length));

  for (final u in sorted) {
    final escaped = RegExp.escape(u.name);
    final re = RegExp('(?<![\\w<])@$escaped(?!\\w)');
    out = out.replaceAll(re, '<@${u.id}>');
  }

  return out;
}
