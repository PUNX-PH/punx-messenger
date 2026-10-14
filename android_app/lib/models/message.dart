import 'package:cloud_firestore/cloud_firestore.dart';

import 'image_meta.dart';
import 'message_author.dart';
import 'reply_snapshot.dart';

/// Mirrors the shared message document shape used under
/// `groups/{g}/channels/{c}/messages`, `dms/{id}/messages`, and
/// `users/{uid}/notes` — see db.js's sendMessage()/listenMessages().
class ChatMessage {
  final String id;
  final String text;

  /// Either an inline base64 data URL (uploads — this app has no Firebase
  /// Storage) or a remote https URL (a GIF from the picker, hosted by Klipy).
  /// Anything rendering it must handle BOTH; see ImageService.isRemoteUrl.
  final String? imageURL;
  final ImageMeta? imageMeta;
  final MessageAuthor author;
  final List<String> mentionedUids;
  final ReplySnapshot? replyTo;
  final Timestamp? createdAt;
  final bool pinned;
  final Timestamp? editedAt;
  final Map<String, List<String>> reactions; // emojiKeyOrToken -> reactor uids

  const ChatMessage({
    required this.id,
    required this.author,
    this.text = '',
    this.imageURL,
    this.imageMeta,
    this.mentionedUids = const [],
    this.replyTo,
    this.createdAt,
    this.pinned = false,
    this.editedAt,
    this.reactions = const {},
  });

  factory ChatMessage.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) =>
      ChatMessage.fromMap(doc.id, doc.data() ?? {});

  /// Tolerant of a malformed document. One message with a non-string `text`
  /// used to throw here, and since this runs inside the snapshot stream's map,
  /// that took the whole chat down with it — the web client had exactly this
  /// crash. A bad field now degrades to empty/absent instead.
  factory ChatMessage.fromMap(String id, Map<String, dynamic> data) {
    final rawReactions = data['reactions'];
    final reactions = <String, List<String>>{};
    if (rawReactions is Map) {
      rawReactions.forEach((k, v) {
        if (k is String && v is List) {
          reactions[k] = v.whereType<String>().toList();
        }
      });
    }
    final rawImageMeta = data['imageMeta'];
    final rawAuthor = data['author'];
    final rawReply = data['replyTo'];
    final rawMentions = data['mentionedUids'];
    return ChatMessage(
      id: id,
      text: data['text'] is String ? data['text'] as String : '',
      imageURL: data['imageURL'] is String ? data['imageURL'] as String : null,
      imageMeta: ImageMeta.fromMap(
        rawImageMeta is Map<String, dynamic> ? rawImageMeta : null,
      ),
      author: MessageAuthor.fromMap(
        rawAuthor is Map<String, dynamic> ? rawAuthor : null,
      ),
      mentionedUids: rawMentions is List
          ? rawMentions.whereType<String>().toList()
          : const [],
      replyTo: ReplySnapshot.fromMap(
        rawReply is Map<String, dynamic> ? rawReply : null,
      ),
      createdAt: data['createdAt'] is Timestamp
          ? data['createdAt'] as Timestamp
          : null,
      pinned: data['pinned'] == true,
      editedAt: data['editedAt'] is Timestamp
          ? data['editedAt'] as Timestamp
          : null,
      reactions: reactions,
    );
  }

  bool get isImageOnly => text.trim().isEmpty && imageURL != null;

  ChatMessage copyWith({bool? pinned}) => ChatMessage(
    id: id,
    text: text,
    imageURL: imageURL,
    imageMeta: imageMeta,
    author: author,
    mentionedUids: mentionedUids,
    replyTo: replyTo,
    createdAt: createdAt,
    pinned: pinned ?? this.pinned,
    editedAt: editedAt,
    reactions: reactions,
  );
}
