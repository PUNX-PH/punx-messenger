import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `/emojis/{emojiId}` — workspace-wide custom emoji, see emojis.jsx.
class CustomEmoji {
  final String id;
  final String name; // lowercase [a-z0-9_]{2,32}, no colons
  final String dataURL; // base64 PNG
  final String? createdBy;
  final Timestamp? createdAt;

  const CustomEmoji({
    required this.id,
    required this.name,
    required this.dataURL,
    this.createdBy,
    this.createdAt,
  });

  factory CustomEmoji.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    return CustomEmoji(
      id: doc.id,
      name: (data['name'] as String?) ?? '',
      dataURL: (data['dataURL'] as String?) ?? '',
      createdBy: data['createdBy'] as String?,
      createdAt: data['createdAt'] as Timestamp?,
    );
  }
}
