import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/message.dart';

// "Seen" in direct messages: under your latest message that the other person has read, a line like
// "Seen 3:41 PM". Mirrors src/lib/seen.js, and uses the same field (`seen.<dm key>` on the person's
// own profile, a server time), so a message read on the web is "Seen" for a phone sender and the
// other way round.
//
// The receipt is NOT built on `lastRead`, which "Mark as read" also writes: it is written only by an
// open conversation, only for a DM, and only while the app is in front (a chat left open in a
// pocket has not been read). Sharing is a choice (`prefs.shareSeen`, the same switch as the web's):
// off means nothing is written and no line is shown to you either.

final RegExp _dmPath = RegExp(r'^dms/[^/]+(/messages)?$');

/// Is this the path of a direct message conversation (`dms/{id}`), with or without a trailing /messages?
bool isDmPath(String? path) => path != null && _dmPath.hasMatch(path);

/// When a person last had a DM open, in milliseconds, from the value stored at `seen.<key>` on
/// their profile. Null when it is absent or not a usable time.
int? seenAtOf(Object? raw) {
  final ms = raw is Timestamp ? raw.millisecondsSinceEpoch : (raw is num && raw.isFinite ? raw.toInt() : null);
  return ms != null && ms > 0 ? ms : null;
}

/// The receipt for one DM from a whole profile document's data (what the other person's app listens
/// to). Null when there is none; a `seen` that is not a map reads as none.
int? seenAtFromProfile(Map<String, dynamic>? data, String key) {
  final seen = data?['seen'];
  return seen is Map ? seenAtOf(seen[key]) : null;
}

/// Is [newest] later than [last] (the last time something was recorded)? A newest message with no
/// time yet (still being sent), or none, counts as new. Same rule as needsMarkRead on the web.
bool needsMark(Timestamp? newest, Timestamp? last) {
  final n = newest?.millisecondsSinceEpoch;
  if (n == null || n == 0) return true;
  return (last?.millisecondsSinceEpoch ?? 0) < n;
}

/// Should the open conversation write a receipt now? Only for a DM, only when you share it, only
/// while the app is in front, and only when there is something newer than the last receipt: so
/// opening a chat that was already "marked as read" still records that it was opened, and re-opening
/// it with nothing new writes nothing.
bool shouldRecordSeen({
  required String containerPath,
  required Timestamp? newestCreatedAt,
  required Timestamp? seen,
  required bool share,
  required bool visible,
}) => share && visible && isDmPath(containerPath) && needsMark(newestCreatedAt, seen);

/// Which message to put the line under: your latest message that was sent at or before the time the
/// other person last had the chat open. Null when none has been seen. [messages] are oldest first.
/// A message of yours with no time yet (still being sent) is not seen.
({String id, int at})? seenMarker(List<ChatMessage> messages, String? meUid, int? seenAt) {
  if (meUid == null || meUid.isEmpty || seenAt == null) return null;
  for (var i = messages.length - 1; i >= 0; i--) {
    final m = messages[i];
    if (m.author.uid != meUid) continue;
    final at = m.createdAt?.millisecondsSinceEpoch;
    if (at == null) continue;
    if (at <= seenAt) return (id: m.id, at: seenAt);
  }
  return null;
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Seen 3:41 PM" for today, "Seen Nov 12, 3:41 PM" for another day. [formatTime] writes a time of
/// day the way this phone's clock is set (12 or 24 hours).
String seenLabel(int at, DateTime now, String Function(DateTime) formatTime) {
  if (at <= 0) return '';
  final when = DateTime.fromMillisecondsSinceEpoch(at);
  final time = formatTime(when);
  if (when.year == now.year && when.month == now.month && when.day == now.day) {
    return 'Seen $time';
  }
  return 'Seen ${_months[when.month - 1]} ${when.day}, $time';
}
