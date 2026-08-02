import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `/groups/{groupId}/channels/{channelId}` — see groups.js.
class Channel {
  final String id;
  final String name;
  final String type; // always 'text' today
  final Timestamp? createdAt;
  final String? createdBy;
  final Timestamp? lastMessageAt;
  final Map<String, Timestamp> typing; // uid -> timestamp, ephemeral

  const Channel({
    required this.id,
    required this.name,
    this.type = 'text',
    this.createdAt,
    this.createdBy,
    this.lastMessageAt,
    this.typing = const {},
  });

  factory Channel.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    final rawTyping = data['typing'] as Map<String, dynamic>? ?? {};
    return Channel(
      id: doc.id,
      name: (data['name'] as String?) ?? '',
      type: (data['type'] as String?) ?? 'text',
      createdAt: data['createdAt'] as Timestamp?,
      createdBy: data['createdBy'] as String?,
      lastMessageAt: data['lastMessageAt'] as Timestamp?,
      typing: rawTyping.map((k, v) => MapEntry(k, v as Timestamp)),
    );
  }
}
