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
