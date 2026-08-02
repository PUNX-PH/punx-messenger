import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/custom_emoji.dart';
import 'image_service.dart';

/// Thrown for validation/uniqueness failures — mirrors the Error() throws in
/// emojis.jsx's createEmoji().
class EmojiValidationException implements Exception {
  final String message;
  const EmojiValidationException(this.message);
  @override
  String toString() => message;
}

final _nameRe = RegExp(r'^[a-z0-9_]{2,32}$');

/// 1:1 port of src/lib/emojis.jsx's data functions (workspace-wide custom
/// emoji, admin-only create/delete, no update — delete + re-create to change).
class EmojisRepository {
  EmojisRepository({FirebaseFirestore? firestore})
    : _db = firestore ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  Stream<List<CustomEmoji>> listenEmojis() {
    return _db
        .collection('emojis')
        .orderBy('name')
        .snapshots()
        .map((snap) => snap.docs.map(CustomEmoji.fromDoc).toList());
  }

  Future<void> createEmoji({
    required String name,
    required Uint8List bytes,
    required String createdBy,
  }) async {
    final n = name.trim().toLowerCase();
    if (!_nameRe.hasMatch(n)) {
      throw const EmojiValidationException(
        'Use 2–32 chars: lowercase letters, numbers, underscore.',
      );
    }
    final existing = await _db.collection('emojis').get();
    if (existing.docs.any((d) => d.data()['name'] == n)) {
      throw EmojiValidationException('":$n:" already exists.');
    }
    final out = await ImageService.resizeToDataUrl(bytes, ImagePresets.emoji);
    await _db.collection('emojis').add({
      'name': n,
      'dataURL': out.dataUrl,
      'createdBy': createdBy,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> deleteEmoji(String emojiId) async {
    await _db.collection('emojis').doc(emojiId).delete();
  }
}
