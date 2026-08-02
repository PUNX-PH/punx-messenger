import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/dm_convo.dart';
import '../models/user_profile.dart';
import '../utils/firestore_paths.dart';

/// 1:1 port of the DM-conversation functions in src/lib/db.js.
class DmRepository {
  DmRepository({FirebaseFirestore? firestore})
    : _db = firestore ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  /// Ensures a DM convo doc exists between `me` and `other`, returning its id.
  Future<String> ensureDmConvo(UserProfile me, UserProfile other) async {
    final id = dmConvoId(me.id, other.id);
    final ref = _db.collection('dms').doc(id);
    final snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        'members': [me.id, other.id]..sort(),
        'memberInfo': {
          me.id: {'name': me.name, 'photoURL': me.photoURL},
          other.id: {'name': other.name, 'photoURL': other.photoURL},
        },
        'createdAt': FieldValue.serverTimestamp(),
        'lastMessageAt': FieldValue.serverTimestamp(),
        'lastMessageText': '',
      });
    }
    return id;
  }

  /// Live DM convos the current user is in, keyed by the *other* member's uid.
  Stream<Map<String, DmConvo>> listenMyDmConvos(String uid) {
    return _db
        .collection('dms')
        .where('members', arrayContains: uid)
        .snapshots()
        .map((snap) {
          final byOther = <String, DmConvo>{};
          for (final doc in snap.docs) {
            final convo = DmConvo.fromDoc(doc);
            final otherUid = convo.otherUid(uid);
            if (otherUid != null) byOther[otherUid] = convo;
          }
          return byOther;
        });
  }
}
