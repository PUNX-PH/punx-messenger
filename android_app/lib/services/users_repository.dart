import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/custom_status.dart';
import '../models/role.dart';
import '../models/user_profile.dart';

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

  Future<void> setUserRole(String uid, Role role) async {
    await _db.collection('users').doc(uid).set({
      'role': role.toFirestore(),
    }, SetOptions(merge: true));
  }
}
