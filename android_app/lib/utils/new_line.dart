import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/message.dart';

/// Where the "New" line goes when a conversation is opened: the id of the first
/// message you have not read, or null when there is nowhere meaningful to put
/// one. Mirrors firstUnreadId in src/lib/unread.js (the web app), so both apps
/// draw the line in the same place.
///
///  - Never read before (no last-read time): null. A new member of a channel
///    with years of history is not told it is all "new".
///  - Your own messages are never "new" to you, so the line goes above the
///    first unread message from someone else.
///  - The very first loaded message is already unread: null. Older ones may be
///    unread too, so a line above this one would say "from here" when it is not.
///  - A message still waiting for its server time has no createdAt and is
///    skipped.
///
/// [messages] are oldest first, as the list has them.
String? firstUnreadId(
  List<ChatMessage> messages,
  Timestamp? lastReadAt,
  String? meUid,
) {
  final read = lastReadAt?.millisecondsSinceEpoch;
  if (read == null || read <= 0) return null;
  final i = messages.indexWhere((m) {
    final at = m.createdAt?.millisecondsSinceEpoch;
    return at != null && at > read && m.author.uid != meUid;
  });
  return i > 0 ? messages[i].id : null;
}

/// Is the "New" line scrolled out of sight ABOVE the visible part of the list?
/// Then a button can take the reader back to it. Both numbers are screen
/// positions: the line's bottom edge and the list's top edge. Anything
/// unmeasurable answers false, so a layout that has not happened yet never
/// shows the button.
bool newLineIsAbove(double? lineBottom, double? viewTop) {
  if (lineBottom == null || viewTop == null) return false;
  if (!lineBottom.isFinite || !viewTop.isFinite) return false;
  return lineBottom <= viewTop;
}
