import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `/groups/{groupId}` — see groups.js.
class Group {
  final String id;
  final String name;
  final String? imageURL; // base64 data URL avatar, or null
  final String? bannerURL; // base64 data URL banner, or null
  final String ownerUid;
  final List<String> adminUids;
  final List<String> memberUids;
  final Timestamp? createdAt;

  const Group({
    required this.id,
    required this.name,
    required this.ownerUid,
    this.imageURL,
    this.bannerURL,
    this.adminUids = const [],
    this.memberUids = const [],
    this.createdAt,
  });

  factory Group.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    return Group(
      id: doc.id,
      name: (data['name'] as String?) ?? '',
      imageURL: data['imageURL'] as String?,
      bannerURL: data['bannerURL'] as String?,
      ownerUid: (data['ownerUid'] as String?) ?? '',
      adminUids: List<String>.from(data['adminUids'] as List? ?? const []),
      memberUids: List<String>.from(data['memberUids'] as List? ?? const []),
      createdAt: data['createdAt'] as Timestamp?,
    );
  }

  bool isOwner(String uid) => ownerUid == uid;
  bool isAdmin(String uid) => adminUids.contains(uid);
  bool isMember(String uid) => memberUids.contains(uid);
}
