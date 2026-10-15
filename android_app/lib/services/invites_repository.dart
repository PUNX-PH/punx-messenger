import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../config/app_config.dart';
import '../models/channel.dart';
import '../models/group.dart';
import '../models/group_invite.dart';

/// Create, list and revoke a group's invite links — the admin half of
/// src/lib/invites.js. Redeeming a link is not here: that happens in the
/// browser the invited person opens it in.
class InvitesRepository {
  InvitesRepository({FirebaseFirestore? firestore})
    : _db = firestore ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  /// 32 random bytes from the OS's secure generator, URL-safe base64, no
  /// padding — 256 bits, 43 characters. The link is the only thing protecting
  /// what it grants, so this must not come from a seedable generator.
  ///
  /// firestore.rules accepts a token of at most 128 characters matching
  /// `[A-Za-z0-9_-]+`; base64url is exactly that alphabet.
  static String newToken([Random? random]) {
    final rng = random ?? Random.secure();
    const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    final out = StringBuffer();
    for (var i = 0; i < 43; i++) {
      out.write(alphabet[rng.nextInt(64)]);
    }
    return out.toString();
  }

  /// The shareable link. Opens in the browser, where a guest can sign in and
  /// join; the web origin comes from [AppConfig.webOrigin].
  static String inviteUrl(String token) =>
      '${AppConfig.webOrigin}/invite/$token';

  /// The document a new invite is written as. A separate function so a test can
  /// hold it against what the web client writes and what firestore.rules reads:
  /// `groupId`, `channelIds` and `expiresAt` are checked, `createdBy` must be the
  /// caller, and `revoked` is the one field that may ever change afterwards.
  static Map<String, Object?> inviteData({
    required Group group,
    required List<Channel> channels,
    required String createdBy,
    required DateTime expiresAt,
  }) => {
    'groupId': group.id,
    'groupName': group.name.isNotEmpty ? group.name : 'a group',
    'channelIds': [for (final c in channels) c.id],
    'channelNames': [for (final c in channels) c.name],
    'createdBy': createdBy,
    'createdAt': FieldValue.serverTimestamp(),
    'expiresAt': Timestamp.fromDate(expiresAt),
    'revoked': false,
  };

  Future<GroupInvite> createInvite({
    required Group group,
    required List<Channel> channels,
    required String createdBy,
    int days = 7,
  }) async {
    final token = newToken();
    final expiresAt = DateTime.now().add(Duration(days: days));
    await _db
        .collection('invites')
        .doc(token)
        .set(
          inviteData(
            group: group,
            channels: channels,
            createdBy: createdBy,
            expiresAt: expiresAt,
          ),
        );
    return GroupInvite(
      token: token,
      groupId: group.id,
      groupName: group.name,
      channelIds: [for (final c in channels) c.id],
      channelNames: [for (final c in channels) c.name],
      createdBy: createdBy,
      expiresAt: Timestamp.fromDate(expiresAt),
    );
  }

  /// Live list for the management screen. Admins only — the rules refuse `list`
  /// on the whole collection, and allow it only for a query that PINS groupId,
  /// which this one does. Newest first.
  Stream<List<GroupInvite>> listenGroupInvites(String groupId) {
    return _db
        .collection('invites')
        .where('groupId', isEqualTo: groupId)
        .snapshots()
        .map((snap) {
          final list = snap.docs.map(GroupInvite.fromDoc).toList();
          int ms(GroupInvite i) => i.createdAt?.millisecondsSinceEpoch ?? 0;
          list.sort((a, b) => ms(b).compareTo(ms(a)));
          return list;
        });
  }

  /// Kills a link. `revoked` is the only field the rules let anyone change.
  Future<void> revokeInvite(String token) =>
      _db.collection('invites').doc(token).update({'revoked': true});
}
