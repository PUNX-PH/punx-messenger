/// Mirrors a message's `replyTo` snapshot — a "threaded reply" is just this
/// embedded quote of the original message, not a real thread/sub-conversation
/// (see components/ChatSurface.jsx / MessageList.jsx on the web app).
class ReplySnapshot {
  final String messageId;
  final String? authorUid;
  final String authorName;
  final String snippet;

  const ReplySnapshot({
    required this.messageId,
    required this.authorName,
    required this.snippet,
    this.authorUid,
  });

  static ReplySnapshot? fromMap(Map<String, dynamic>? data) {
    if (data == null) return null;
    return ReplySnapshot(
      // `is String`, not `as String?`: a wrong-typed field must not throw, since
      // that would take the whole message stream down (see ChatMessage.fromMap).
      messageId: data['messageId'] is String ? data['messageId'] as String : '',
      authorUid: data['authorUid'] is String
          ? data['authorUid'] as String
          : null,
      authorName: data['authorName'] is String
          ? data['authorName'] as String
          : 'Unknown',
      snippet: data['snippet'] is String ? data['snippet'] as String : '',
    );
  }

  Map<String, dynamic> toMap() => {
    'messageId': messageId,
    'authorUid': authorUid,
    'authorName': authorName,
    'snippet': snippet,
  };
}
