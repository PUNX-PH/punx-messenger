import '../models/message.dart';

// Threads, built from replies that already exist. Mirrors src/lib/threads.js.
//
// A reply carries `replyTo.messageId`. A thread is a message plus the messages that reply to it, so
// nothing new is stored and the web, the phone and bots all take part: every reply ever sent is in a
// thread. Replies still appear in the conversation, with their quote, as before; the thread is the
// same replies gathered in one place.
//
// Only direct replies belong to a thread. A reply to a reply starts a thread of its own, so a thread
// is flat and never nests.

/// How many replies one thread reads (the same cap as the web's THREAD_LIMIT).
const threadReplyLimit = 200;

/// The id of the message this one replies to, or null (not a reply, malformed, or "a reply to itself").
String? replyTargetOf(ChatMessage message) {
  final id = message.replyTo?.messageId;
  if (id == null || id.isEmpty || id == message.id) return null;
  return id;
}

/// How many direct replies each message has in [messages]: message id -> count (only those with any).
Map<String, int> replyCounts(Iterable<ChatMessage> messages) {
  final counts = <String, int>{};
  for (final m in messages) {
    final target = replyTargetOf(m);
    if (target != null) counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}

/// Oldest first; a message still being sent (no time yet) last; ties by id so the order never flickers.
List<ChatMessage> sortByTime(Iterable<ChatMessage> list) {
  final out = list.toList();
  out.sort((a, b) {
    final ta = a.createdAt?.millisecondsSinceEpoch;
    final tb = b.createdAt?.millisecondsSinceEpoch;
    if (ta == null && tb != null) return 1;
    if (tb == null && ta != null) return -1;
    if (ta != tb && ta != null && tb != null) return ta - tb;
    return a.id.compareTo(b.id);
  });
  return out;
}

/// The replies to [rootId] among [list], in order. (The root is never one of them: a message cannot
/// reply to itself, see [replyTargetOf].)
List<ChatMessage> threadReplies(Iterable<ChatMessage> list, String? rootId) {
  if (rootId == null) return const []; // null would match every message that is not a reply
  return sortByTime(list.where((m) => replyTargetOf(m) == rootId));
}

/// "1 reply", "3 replies".
String replyLabel(int n) => '$n ${n == 1 ? 'reply' : 'replies'}';

/// Where threads are offered: conversations, not your private notes (nobody to reply to).
bool threadsAllowed(String? path) =>
    path != null && (path.startsWith('dms/') || path.startsWith('groups/'));

/// What is open: the message as it is now if it is still loaded, else the copy taken when the thread
/// was opened.
ChatMessage currentRoot(Iterable<ChatMessage> messages, ChatMessage opened) {
  for (final m in messages) {
    if (m.id == opened.id) return m;
  }
  return opened;
}

// ---------- what is new in a thread ----------
//
// Mirrors src/lib/threads.js. A reply is NEW in its thread when someone else wrote it after the
// conversation was last read before you opened it (the same moment the "New" line is drawn from) and
// after you last had that thread open. Nothing is stored for this: the "last had it open" times live
// in the open screen, and a conversation opened again starts from its own last-read time.

/// How many replies to each message are new to [meUid]: message id -> count (only those with any).
/// [sinceMs] is the last-read time of the conversation when it was opened; when it is not known
/// (never read, notes, not loaded yet) nothing is new, as with the "New" line. [seen] is
/// `{messageId: ms}`, how far each thread has been looked at. Your own replies, and ones still being
/// sent (no time yet), are never new.
Map<String, int> newReplyCounts(
  Iterable<ChatMessage> messages,
  String? meUid,
  int? sinceMs, [
  Map<String, int> seen = const {},
]) {
  final counts = <String, int>{};
  if (sinceMs == null) return counts;
  for (final m in messages) {
    final target = replyTargetOf(m);
    final t = m.createdAt?.millisecondsSinceEpoch;
    if (target == null || t == null || m.author.uid == meUid) continue;
    final seenAt = seen[target] ?? 0;
    if (t > (sinceMs > seenAt ? sinceMs : seenAt)) {
      counts[target] = (counts[target] ?? 0) + 1;
    }
  }
  return counts;
}

/// [seen] with the thread of [rootId] marked looked at up to its newest reply in [replies]. The SAME
/// map back when that moves nothing (a thread is never "unseen" again, and a reply still being sent
/// has no time), so a state holding it does not change for nothing.
Map<String, int> markThreadSeen(
  Map<String, int> seen,
  String rootId,
  Iterable<ChatMessage> replies,
) {
  int? newest;
  for (final m in replies) {
    final t = m.createdAt?.millisecondsSinceEpoch;
    if (t != null && (newest == null || t > newest)) newest = t;
  }
  if (newest == null || newest <= (seen[rootId] ?? 0)) return seen;
  return {...seen, rootId: newest};
}

/// The words for the new ones, beside "3 replies": "2 new".
String newRepliesLabel(int n) => '$n new';
