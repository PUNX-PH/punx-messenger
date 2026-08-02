import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/channel.dart';
import '../models/group.dart';
import '../models/user_profile.dart';
import '../utils/firestore_paths.dart';
import 'id_gen.dart';
import 'image_service.dart';

/// 1:1 port of src/lib/groups.js.
class GroupsRepository {
  GroupsRepository({FirebaseFirestore? firestore})
    : _db = firestore ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  /// Groups the user belongs to, sorted client-side by createdAt to skip a
  /// composite index (mirrors listenMyGroups in groups.js).
  Stream<List<Group>> listenMyGroups(String uid) {
    return _db
        .collection('groups')
        .where('memberUids', arrayContains: uid)
        .snapshots()
        .map((snap) {
          final groups = snap.docs.map(Group.fromDoc).toList();
          groups.sort((a, b) {
            final ta = a.createdAt?.millisecondsSinceEpoch ?? 0;
            final tb = b.createdAt?.millisecondsSinceEpoch ?? 0;
            return ta.compareTo(tb);
          });
          return groups;
        });
  }

  Stream<List<Channel>> listenChannels(String groupId) {
    return _db
        .collection('groups')
        .doc(groupId)
        .collection('channels')
        .orderBy('createdAt')
        .snapshots()
        .map((snap) => snap.docs.map(Channel.fromDoc).toList());
  }

  Stream<Group?> listenGroup(String groupId) {
    return _db
        .collection('groups')
        .doc(groupId)
        .snapshots()
        .map((snap) => snap.exists ? Group.fromDoc(snap) : null);
  }

  /// Creates a group (optionally with an avatar) and auto-provisions a
  /// #general channel in the same batch. Returns (groupId, generalChannelId).
  Future<(String groupId, String generalChannelId)> createGroup({
    required String name,
    required UserProfile owner,
    Uint8List? avatarBytes,
  }) async {
    final groupId = newId();

    String? imageUrl;
    if (avatarBytes != null) {
      final out = await ImageService.resizeToDataUrl(
        avatarBytes,
        ImagePresets.avatar,
      );
      imageUrl = out.dataUrl;
    }

    final batch = _db.batch();
    batch.set(_db.collection('groups').doc(groupId), {
      'name': name.trim(),
      'imageURL': imageUrl,
      'bannerURL': null,
      'ownerUid': owner.id,
      'adminUids': [owner.id],
      'memberUids': [owner.id],
      'createdAt': FieldValue.serverTimestamp(),
    });
    final generalRef = _db
        .collection('groups')
        .doc(groupId)
        .collection('channels')
        .doc();
    batch.set(generalRef, {
      'name': 'general',
      'type': 'text',
      'createdAt': FieldValue.serverTimestamp(),
      'createdBy': owner.id,
    });
    await batch.commit();

    return (groupId, generalRef.id);
  }

  Future<String> createChannel(
    String groupId, {
    required String name,
    required String createdBy,
  }) async {
    final ref = await _db
        .collection('groups')
        .doc(groupId)
        .collection('channels')
        .add({
          'name': name.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '-'),
          'type': 'text',
          'createdAt': FieldValue.serverTimestamp(),
          'createdBy': createdBy,
        });
    return ref.id;
  }

  Future<void> addMember(String groupId, String uid) async {
    await _db.collection('groups').doc(groupId).set({
      'memberUids': FieldValue.arrayUnion([uid]),
    }, SetOptions(merge: true));
  }

  Future<void> removeMember(String groupId, String uid) async {
    await _db.collection('groups').doc(groupId).set({
      'memberUids': FieldValue.arrayRemove([uid]),
      'adminUids': FieldValue.arrayRemove([uid]),
    }, SetOptions(merge: true));
  }

  Future<void> setGroupAdmin(String groupId, String uid, bool isAdmin) async {
    await _db.collection('groups').doc(groupId).set({
      'adminUids': isAdmin
          ? FieldValue.arrayUnion([uid])
          : FieldValue.arrayRemove([uid]),
    }, SetOptions(merge: true));
  }

  /// Marks every channel in the group as read for the current user.
  Future<void> markGroupAsRead(String uid, String groupId) async {
    final channelsSnap = await _db
        .collection('groups')
        .doc(groupId)
        .collection('channels')
        .get();
    if (channelsSnap.docs.isEmpty) return;
    final updates = <String, dynamic>{};
    for (final c in channelsSnap.docs) {
      updates['lastRead.${pathToReadKey('groups/$groupId/channels/${c.id}')}'] =
          FieldValue.serverTimestamp();
    }
    await _db.collection('users').doc(uid).update(updates);
  }

  Future<void> toggleMuteGroup(String uid, String groupId, bool mute) async {
    await _db.collection('users').doc(uid).update({
      'mutedGroups': mute
          ? FieldValue.arrayUnion([groupId])
          : FieldValue.arrayRemove([groupId]),
    });
  }

  /// Owners can't leave (must transfer ownership first — not otherwise
  /// exposed in the UI, so this is a hard rule).
  Future<void> leaveGroup(String groupId, String uid, String ownerUid) async {
    if (ownerUid == uid) {
      throw StateError("You're the owner — transfer ownership before leaving.");
    }
    await _db.collection('groups').doc(groupId).update({
      'memberUids': FieldValue.arrayRemove([uid]),
      'adminUids': FieldValue.arrayRemove([uid]),
    });
  }

  Future<void> updateGroup(String groupId, Map<String, dynamic> updates) async {
    await _db
        .collection('groups')
        .doc(groupId)
        .set(updates, SetOptions(merge: true));
  }

  Future<void> updateGroupAvatar(String groupId, Uint8List bytes) async {
    final out = await ImageService.resizeToDataUrl(bytes, ImagePresets.avatar);
    await updateGroup(groupId, {'imageURL': out.dataUrl});
  }

  /// Pass `bytes: null` to remove the banner.
  Future<void> updateGroupBanner(String groupId, Uint8List? bytes) async {
    if (bytes == null) {
      await updateGroup(groupId, {'bannerURL': null});
      return;
    }
    final out = await ImageService.resizeToDataUrl(bytes, ImagePresets.banner);
    await updateGroup(groupId, {'bannerURL': out.dataUrl});
  }
}
