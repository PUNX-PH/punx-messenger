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
      messageId: (data['messageId'] as String?) ?? '',
      authorUid: data['authorUid'] as String?,
      authorName: (data['authorName'] as String?) ?? 'Unknown',
      snippet: (data['snippet'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toMap() => {
    'messageId': messageId,
    'authorUid': authorUid,
    'authorName': authorName,
    'snippet': snippet,
  };
}
