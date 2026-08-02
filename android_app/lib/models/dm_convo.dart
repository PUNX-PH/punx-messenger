import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `/dms/{convoId}` — see db.js. `id` is the sorted-uid-join produced
/// by `dmConvoId(a, b)`.
class DmConvo {
  final String id;
  final List<String> members; // exactly 2 uids, sorted
  final Map<String, DmMemberInfo> memberInfo;
  final Timestamp? createdAt;
  final Timestamp? lastMessageAt;
  final String lastMessageText;
  final String? lastMessageAuthorUid;
  final Map<String, Timestamp> typing;

  const DmConvo({
    required this.id,
    required this.members,
    this.memberInfo = const {},
    this.createdAt,
    this.lastMessageAt,
    this.lastMessageText = '',
    this.lastMessageAuthorUid,
    this.typing = const {},
  });

  factory DmConvo.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    final rawInfo = data['memberInfo'] as Map<String, dynamic>? ?? {};
    final rawTyping = data['typing'] as Map<String, dynamic>? ?? {};
    return DmConvo(
      id: doc.id,
      members: List<String>.from(data['members'] as List? ?? const []),
      memberInfo: rawInfo.map(
        (k, v) => MapEntry(k, DmMemberInfo.fromMap(v as Map<String, dynamic>)),
      ),
      createdAt: data['createdAt'] as Timestamp?,
      lastMessageAt: data['lastMessageAt'] as Timestamp?,
      lastMessageText: (data['lastMessageText'] as String?) ?? '',
      lastMessageAuthorUid: data['lastMessageAuthorUid'] as String?,
      typing: rawTyping.map((k, v) => MapEntry(k, v as Timestamp)),
    );
  }

  /// The other participant's uid, given my own.
  String? otherUid(String myUid) {
    for (final m in members) {
      if (m != myUid) return m;
    }
    return null;
  }
}

class DmMemberInfo {
  final String name;
  final String? photoURL;
  const DmMemberInfo({required this.name, this.photoURL});

  factory DmMemberInfo.fromMap(Map<String, dynamic> data) => DmMemberInfo(
    name: (data['name'] as String?) ?? '',
    photoURL: data['photoURL'] as String?,
  );
}
