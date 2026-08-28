import 'dart:async';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/channel.dart';
import '../models/channel_viewer.dart';
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

  /// The channel queries `viewer` is allowed to run, merged into one stream.
  ///
  /// This collection is never queried unfiltered any more. firestore.rules
  /// reads `private` off the channel without an existence guard, and an
  /// unfiltered query leaves that field unknown — which errors, and an error
  /// denies. Only a query that pins `private`, or pins `allowUids` to the
  /// caller, can be proven safe. So:
  ///
  ///   guest            allowUids contains me   (and nothing else)
  ///   member           private == false, and allowUids contains me
  ///   admin/oversight  the above, plus private == true
  ///
  /// The last leg is a guess at admin rights and is marked optional: if the
  /// rules disagree it is dropped and the rest of the list still arrives.
  /// Mirrors listenChannels in src/lib/groups.js — keep the two in step.
  Stream<List<Channel>> listenChannels(
    String groupId, {
    ChannelViewer viewer = ChannelViewer.anonymous,
  }) {
    final col = _db.collection('groups').doc(groupId).collection('channels');
    final uid = viewer.uid;

    final legs = <(Query<Map<String, dynamic>>, bool)>[];
    if (viewer.guest) {
      legs.add((col.where('allowUids', arrayContains: uid), false));
    } else {
      legs.add((col.where('private', isEqualTo: false), false));
      if (uid != null) {
        legs.add((col.where('allowUids', arrayContains: uid), false));
      }
      if (viewer.seesPrivate) {
        legs.add((col.where('private', isEqualTo: true), true));
      }
    }

    // One page per leg, null until that leg has reported. Nothing is emitted
    // until every leg has: a partial first list would show a channel list
    // missing half its rows and then jump.
    final pages = List<List<Channel>?>.filled(legs.length, null);
    final subs = <StreamSubscription<QuerySnapshot<Map<String, dynamic>>>>[];
    late final StreamController<List<Channel>> controller;

    void emit() {
      if (pages.any((page) => page == null)) return;
      final byId = <String, Channel>{};
      for (final page in pages) {
        for (final channel in page!) {
          byId[channel.id] = channel;
        }
      }
      final list = byId.values.toList()
        ..sort((a, b) {
          final ta = a.createdAt?.millisecondsSinceEpoch ?? 0;
          final tb = b.createdAt?.millisecondsSinceEpoch ?? 0;
          return ta.compareTo(tb);
        });
      controller.add(list);
    }

    controller = StreamController<List<Channel>>(
      onListen: () {
        for (var i = 0; i < legs.length; i++) {
          final (q, optional) = legs[i];
          final index = i;
          subs.add(
            q.snapshots().listen(
              (snap) {
                pages[index] = snap.docs.map(Channel.fromDoc).toList();
                emit();
              },
              onError: (Object e, StackTrace st) {
                // Expected whenever the admin guess was wrong; the viewer
                // simply doesn't get the private channels.
                if (optional) {
                  pages[index] = const [];
                  emit();
                  return;
                }
                controller.addError(e, st);
              },
            ),
          );
        }
      },
      onCancel: () async {
        for (final sub in subs) {
          await sub.cancel();
        }
      },
    );
    return controller.stream;
  }

  Stream<Channel?> listenChannel(String groupId, String channelId) {
    return _db
        .collection('groups')
        .doc(groupId)
        .collection('channels')
        .doc(channelId)
        .snapshots()
        .map((snap) => snap.exists ? Channel.fromDoc(snap) : null);
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
      // Written even though #general is as public as a channel gets: the
      // rules read `private` unguarded, so a channel without the key is
      // denied outright rather than treated as public. See listenChannels.
      'private': false,
      'allowUids': [owner.id],
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
          // Both fields are mandatory now — see createGroup above.
          'private': false,
          'allowUids': [createdBy],
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

  /// Marks every channel the user can SEE as read.
  ///
  /// Same constraint as listenChannels: the unfiltered fetch this used to do
  /// is denied to anyone below admin. Marking a channel you can't see read
  /// would be meaningless anyway — it can hold no unread badge for you.
  Future<void> markGroupAsRead(
    String uid,
    String groupId, {
    ChannelViewer viewer = ChannelViewer.anonymous,
  }) async {
    final channels = await listenChannels(groupId, viewer: viewer).first;
    if (channels.isEmpty) return;
    final updates = <String, dynamic>{};
    for (final c in channels) {
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
