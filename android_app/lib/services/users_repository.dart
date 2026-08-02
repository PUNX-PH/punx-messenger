import 'package:cloud_firestore/cloud_firestore.dart';

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

  Future<void> setUserRole(String uid, Role role) async {
    await _db.collection('users').doc(uid).set({
      'role': role.toFirestore(),
    }, SetOptions(merge: true));
  }
}
