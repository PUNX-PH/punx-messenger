import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/custom_status.dart';
import '../models/role.dart';
import '../models/user_profile.dart';
import '../utils/seen.dart';

/// 1:1 port of the read-side of src/lib/users.jsx / db.js's listenUsers.
class UsersRepository {
  UsersRepository({FirebaseFirestore? firestore})
    : _db = firestore ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  /// Live workspace directory, ordered by name.
  Stream<List<UserProfile>> listenUsers() {
    return _db
        .collection('users')
        .orderBy('name')
        .snapshots()
        .map((snap) => snap.docs.map(UserProfile.fromDoc).toList());
  }

  /// Sets or clears your own status (see models/custom_status.dart): null clears it. The text is
  /// cleaned again here, so only a short clean line is ever written, whatever called this.
  Future<void> setMyStatus(String uid, Map<String, Object?>? status) async {
    final text = cleanStatusText(status?['text']);
    final until = status?['until'];
    await _db.collection('users').doc(uid).update({
      'status': text.isEmpty
          ? FieldValue.delete()
          : {'text': text, 'until': until is num && until.isFinite ? until : null},
    });
  }

  /// Switches do-not-disturb on or off for yourself (see models/dnd.dart): null switches it off. Only
  /// a time or null is ever written, whatever called this.
  Future<void> setMyDnd(String uid, Map<String, Object?>? dnd) async {
    final until = dnd?['until'];
    await _db.collection('users').doc(uid).update({
      'dnd': dnd == null
          ? FieldValue.delete()
          : {'until': until is num && until.isFinite ? until : null},
    });
  }

  /// When the OTHER person last had this DM open (ms), from their profile: one document, while the
  /// conversation is on screen. A failure reads as "not seen", so it is swallowed.
  Stream<int?> listenPeerSeen(String otherUid, String key) => _db
      .collection('users')
      .doc(otherUid)
      .snapshots()
      .map((snap) => seenAtFromProfile(snap.data(), key))
      .handleError((_) {});

  /// The web's Preferences switch "Let others see when I've read their messages" (`prefs.shareSeen`),
  /// written the way the web writes preferences: the choice plus `updatedAt`, which is how the web
  /// tells a newer copy from an older one. Switching it OFF also removes every receipt already written,
  /// in the same write.
  Future<void> setShareSeen(String uid, bool on) async {
    await _db.collection('users').doc(uid).update({
      'prefs.shareSeen': on,
      'prefs.updatedAt': DateTime.now().millisecondsSinceEpoch,
      if (!on) 'seen': FieldValue.delete(),
    });
  }

  Future<void> setUserRole(String uid, Role role) async {
    await _db.collection('users').doc(uid).set({
      'role': role.toFirestore(),
    }, SetOptions(merge: true));
  }
}
