import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:google_sign_in/google_sign_in.dart';

import '../config/app_config.dart';
import '../models/role.dart';

/// Thrown when sign-in succeeds with Google/Firebase but the account is
/// outside the allowed workspace domain, or the Firestore profile sync fails.
class AuthException implements Exception {
  final String message;
  const AuthException(this.message);
  @override
  String toString() => message;
}

/// 1:1 port of src/lib/auth.jsx's sign-in + first-sign-in profile bootstrap.
class AuthService {
  AuthService({
    fb_auth.FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    GoogleSignIn? googleSignIn,
  }) : _auth = auth ?? fb_auth.FirebaseAuth.instance,
       _firestore = firestore ?? FirebaseFirestore.instance,
       _googleSignIn =
           googleSignIn ?? GoogleSignIn(scopes: const ['email', 'profile']);

  final fb_auth.FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final GoogleSignIn _googleSignIn;

  Stream<fb_auth.User?> authStateChanges() => _auth.authStateChanges();
  fb_auth.User? get currentUser => _auth.currentUser;

  /// Signs in with Google, enforces the workspace domain restriction, and
  /// ensures the `/users/{uid}` profile doc exists (mirrors auth.jsx's
  /// onAuthStateChanged handler, run explicitly at sign-in time instead).
  Future<void> signIn() async {
    fb_auth.User? user;

    if (kIsWeb) {
      // On web, use Firebase Auth's own popup flow directly — the same
      // approach the React web app uses (src/lib/auth.jsx's
      // signInWithPopup) — rather than the separate google_sign_in-web
      // flow, which needs its own OAuth client wiring.
      final provider = fb_auth.GoogleAuthProvider()
        ..setCustomParameters({
          'hd': AppConfig.allowedEmailDomain,
          'prompt': 'select_account',
        });
      final userCredential = await _auth.signInWithPopup(provider);
      user = userCredential.user;
    } else {
      final googleAccount = await _googleSignIn.signIn();
      if (googleAccount == null) return; // user cancelled the picker

      final googleAuth = await googleAccount.authentication;
      final credential = fb_auth.GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );
      final userCredential = await _auth.signInWithCredential(credential);
      user = userCredential.user;
    }

    if (user == null) {
      throw const AuthException('Sign-in failed: no user returned.');
    }

    final email = (user.email ?? '').toLowerCase();
    if (!AppConfig.isEmailAllowed(email)) {
      await signOut();
      final extras = AppConfig.allowedExtraEmails.isNotEmpty
          ? ' Some external addresses are also allowed.'
          : '';
      throw AuthException(
        'Only @${AppConfig.allowedEmailDomain} accounts can sign in.$extras',
      );
    }

    try {
      await _syncProfile(user, email);
    } on FirebaseException catch (e) {
      await signOut();
      if (e.code == 'permission-denied') {
        throw const AuthException(
          'Firestore rules are blocking your user profile. Check firestore.rules in the Firebase console.',
        );
      }
      throw AuthException('Sign-in failed: ${e.message ?? e.code}');
    }
  }

  Future<void> _syncProfile(fb_auth.User user, String email) async {
    final ref = _firestore.collection('users').doc(user.uid);
    final snap = await ref.get();
    final isSuper = AppConfig.isBootstrapSuperAdmin(email);

    if (!snap.exists) {
      await ref.set({
        'uid': user.uid,
        'email': email,
        'name': user.displayName ?? email.split('@').first,
        'photoURL': user.photoURL,
        'role': isSuper
            ? Role.superAdmin.toFirestore()
            : Role.employee.toFirestore(),
        'createdAt': FieldValue.serverTimestamp(),
        'lastSeen': FieldValue.serverTimestamp(),
      });
    } else {
      final existing = snap.data() ?? {};
      await ref.set({
        'name': user.displayName ?? existing['name'],
        'photoURL': user.photoURL ?? existing['photoURL'],
        'lastSeen': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
  }

  Future<void> signOut() async {
    if (kIsWeb) {
      await _auth.signOut();
    } else {
      await Future.wait([_auth.signOut(), _googleSignIn.signOut()]);
    }
  }
}
