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

  factory ChatMessage.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    final rawReactions = data['reactions'] as Map<String, dynamic>? ?? {};
    return ChatMessage(
      id: doc.id,
      text: (data['text'] as String?) ?? '',
      imageURL: data['imageURL'] as String?,
      imageMeta: ImageMeta.fromMap(data['imageMeta'] as Map<String, dynamic>?),
      author: MessageAuthor.fromMap(data['author'] as Map<String, dynamic>?),
      mentionedUids: List<String>.from(
        data['mentionedUids'] as List? ?? const [],
      ),
      replyTo: ReplySnapshot.fromMap(data['replyTo'] as Map<String, dynamic>?),
      createdAt: data['createdAt'] as Timestamp?,
      pinned: (data['pinned'] as bool?) ?? false,
      editedAt: data['editedAt'] as Timestamp?,
      reactions: rawReactions.map(
        (k, v) => MapEntry(k, List<String>.from(v as List)),
      ),
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
