import 'package:cloud_firestore/cloud_firestore.dart';

/// Path helpers ported 1:1 from src/lib/db.js.

/// Encodes a container path into a safe Firestore map key for `lastRead`.
/// "dms/xxx" -> "dms__xxx"; "groups/x/channels/y" -> "groups__x__channels__y".
String pathToReadKey(String containerPath) =>
    containerPath.replaceAll('/', '__');

/// Deterministic DM convo id from two uids (sorted so either party computes
/// the same id).
String dmConvoId(String a, String b) {
  final sorted = [a, b]..sort();
  return sorted.join('__');
}

/// Strips a trailing `/messages` segment to get the container (channel/DM)
/// path from a messages-collection path.
String containerPathFromMessagesPath(String messagesPath) {
  return messagesPath.replaceFirst(RegExp(r'/messages$'), '');
}

/// True if `lastMessageAt` is newer than `lastReadAt` (either may be null).
bool isUnread(Timestamp? lastMessageAt, Timestamp? lastReadAt) {
  if (lastMessageAt == null) return false;
  final m = lastMessageAt.millisecondsSinceEpoch;
  final r = lastReadAt?.millisecondsSinceEpoch ?? 0;
  return m > r;
}
