import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../markdown/mention_resolver.dart';
import '../models/message.dart';
import '../models/reply_snapshot.dart';
import '../models/user_profile.dart';
import '../utils/constants.dart';
import '../utils/firestore_paths.dart';
import 'image_service.dart';

/// 1:1 port of the message-level functions in src/lib/db.js. `path` is a
/// slash-joined Firestore path, e.g. `'dms/<id>/messages'` or
/// `'groups/<gid>/channels/<cid>/messages'`, matching the web app's
/// convention exactly (paths are shared/interoperable between clients).
class MessagesRepository {
  MessagesRepository({FirebaseFirestore? firestore})
    : _db = firestore ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  Stream<List<ChatMessage>> listenMessages(
    String path, {
    int limit = AppTiming.messageLoadLimit,
  }) {
    return _db
        .collection(path)
        .orderBy('createdAt')
        .limit(limit)
        .snapshots()
        .map((snap) => snap.docs.map(ChatMessage.fromDoc).toList());
  }

  /// Sends a message at the given collection path. `imageBytes`/`imageName`
  /// are optional — when present the image is resized+compressed client-side
  /// (no Firebase Storage) and embedded as a base64 data URL, matching
  /// images.js's MESSAGE_IMAGE preset.
  Future<void> sendMessage(
    String path, {
    required String text,
    required UserProfile author,
    Uint8List? imageBytes,
    String? imageName,
    ChatMessage? replyTo,
    String? remoteImageUrl,
    Map<String, dynamic>? remoteImageMeta,
  }) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty && imageBytes == null && remoteImageUrl == null) return;

    final msgRef = _db.collection(path).doc();

    String? imageUrl;
    Map<String, dynamic>? imageMeta;
    // A GIF is already hosted, so it is stored as a plain URL with no upload
    // and no resize — exactly what Composer.jsx's sendGif does on the web.
    // Running it through ImageService would fetch and re-encode someone else's
    // animation into a data URL, losing the animation and bloating the doc.
    if (remoteImageUrl != null) {
      imageUrl = remoteImageUrl;
      imageMeta = remoteImageMeta;
    } else if (imageBytes != null) {
      final out = await ImageService.resizeToDataUrl(
        imageBytes,
        ImagePresets.messageImage,
      );
      imageUrl = out.dataUrl;
      imageMeta = {
        'width': out.width,
        'height': out.height,
        'approxBytes': out.approxBytes,
        'originalName': imageName ?? '',
      };
    }

    Map<String, dynamic>? replyToMap;
    if (replyTo != null) {
      final rawSnippet = replyTo.text.isNotEmpty
          ? replyTo.text
          : (replyTo.imageURL != null ? '[image]' : '');
      final snippet = rawSnippet.length > 160
          ? rawSnippet.substring(0, 160)
          : rawSnippet;
      replyToMap = ReplySnapshot(
        messageId: replyTo.id,
        authorUid: replyTo.author.uid,
        authorName: replyTo.author.name,
        snippet: snippet,
      ).toMap();
    }

    await msgRef.set({
      'text': trimmed,
      'imageURL': imageUrl,
      'imageMeta': imageMeta,
      'author': {
        'uid': author.id,
        'name': author.name,
        'photoURL': author.photoURL,
      },
      'mentionedUids': extractMentionedUids(trimmed),
      'replyTo': replyToMap,
      'createdAt': FieldValue.serverTimestamp(),
      'pinned': false,
    });

    // Bump parent container metadata so sidebars/rail can show unread state.
    // Non-fatal: the message is already written even if this fails.
    try {
      if (path.startsWith('dms/')) {
        final convoId = path.split('/')[1];
        await _db.collection('dms').doc(convoId).set({
          'lastMessageAt': FieldValue.serverTimestamp(),
          'lastMessageText': trimmed.isNotEmpty ? trimmed : '📷 Image',
          'lastMessageAuthorUid': author.id,
        }, SetOptions(merge: true));
      } else if (path.startsWith('groups/') && path.contains('/channels/')) {
        final parts = path.split('/');
        await _db
            .collection('groups')
            .doc(parts[1])
            .collection('channels')
            .doc(parts[3])
            .set({
              'lastMessageAt': FieldValue.serverTimestamp(),
            }, SetOptions(merge: true));
      }
    } catch (_) {
      // non-fatal, matches db.js's sendMessage
    }
  }

  Future<void> setMessagePinned(String messagePath, bool pinned) async {
    await _db.doc(messagePath).update({'pinned': pinned});
  }

  /// Toggle semantics: add self if absent, remove self if present. Last
  /// writer wins under concurrent taps — acceptable for reactions.
  Future<void> toggleReaction(
    String messagePath,
    String key,
    String uid,
  ) async {
    final ref = _db.doc(messagePath);
    final snap = await ref.get();
    if (!snap.exists) return;
    final reactions = Map<String, dynamic>.from(
      snap.data()?['reactions'] as Map<String, dynamic>? ?? {},
    );
    final uids = List<String>.from(reactions[key] as List? ?? const []);
    if (uids.contains(uid)) {
      uids.remove(uid);
      if (uids.isEmpty) {
        reactions.remove(key);
      } else {
        reactions[key] = uids;
      }
    } else {
      reactions[key] = [...uids, uid];
    }
    await ref.update({'reactions': reactions});
  }

  Future<void> editMessageText(String messagePath, String text) async {
    await _db.doc(messagePath).update({
      'text': text.trim(),
      'editedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> deleteMessage(String messagePath) async {
    await _db.doc(messagePath).delete();
  }

  /// Live container doc (channel or DM convo) — used for typing indicators.
  Stream<Map<String, dynamic>?> listenContainer(String containerPath) {
    return _db
        .doc(containerPath)
        .snapshots()
        .map((snap) => snap.exists ? snap.data() : null);
  }

  /// Uses a dot-path so we only touch `typing.{uid}`, not the whole map.
  Future<void> setTyping(
    String containerPath,
    String uid,
    bool isTyping,
  ) async {
    try {
      await _db.doc(containerPath).update({
        'typing.$uid': isTyping
            ? FieldValue.serverTimestamp()
            : FieldValue.delete(),
      });
    } catch (_) {
      // non-fatal, matches db.js's setTyping
    }
  }

  /// Marks a channel/DM as read by the current user.
  Future<void> markRead(String uid, String containerPath) async {
    if (uid.isEmpty || containerPath.isEmpty) return;
    final key = pathToReadKey(containerPath);
    await _db.collection('users').doc(uid).update({
      'lastRead.$key': FieldValue.serverTimestamp(),
    });
  }
}
