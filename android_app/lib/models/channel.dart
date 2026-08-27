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

  /// Hidden from group members not in [allowUids]. Both keys are written on
  /// every channel now — firestore.rules reads `private` without an existence
  /// guard, so a channel missing it is denied rather than treated as public.
  /// Visibility is enforced by the query legs in
  /// GroupsRepository.listenChannels; these two are here so the UI can mark a
  /// private channel as one.
  final bool private;
  final List<String> allowUids;

  const Channel({
    required this.id,
    required this.name,
    this.type = 'text',
    this.createdAt,
    this.createdBy,
    this.lastMessageAt,
    this.typing = const {},
    this.private = false,
    this.allowUids = const [],
  });

  factory Channel.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) =>
      Channel.fromMap(doc.id, doc.data() ?? const <String, dynamic>{});

  /// Split out from [fromDoc] the same way UserProfile.fromMap is, so the
  /// field parsing can be tested without a Firestore snapshot — it decides
  /// whether a channel reads as private, and getting that wrong is silent.
  factory Channel.fromMap(String id, Map<String, dynamic> data) {
    final rawTyping = data['typing'] as Map<String, dynamic>? ?? {};
    return Channel(
      id: id,
      name: (data['name'] as String?) ?? '',
      type: (data['type'] as String?) ?? 'text',
      createdAt: data['createdAt'] as Timestamp?,
      createdBy: data['createdBy'] as String?,
      lastMessageAt: data['lastMessageAt'] as Timestamp?,
      typing: rawTyping.map((k, v) => MapEntry(k, v as Timestamp)),
      private: data['private'] == true,
      allowUids: List<String>.from(data['allowUids'] as List? ?? const []),
    );
  }
}
