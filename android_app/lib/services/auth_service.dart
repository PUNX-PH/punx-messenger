import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:google_sign_in/google_sign_in.dart';

import '../config/app_config.dart';
import '../config/emulators.dart';
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
       _injectedGoogleSignIn = googleSignIn;

  final fb_auth.FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final GoogleSignIn? _injectedGoogleSignIn;
  GoogleSignIn? _lazyGoogleSignIn;

  /// Built on first use, and never on web.
  ///
  /// The google_sign_in web plugin reads a `google-signin-client_id` meta tag
  /// while constructing, and there isn't one in web/index.html — so building
  /// this eagerly threw before the app could render a single frame, which is
  /// why the web target had never run. The web path uses signInWithPopup and
  /// never touches this, so the fix is simply not to build it until asked.
  GoogleSignIn get _googleSignIn =>
      _injectedGoogleSignIn ??
      (_lazyGoogleSignIn ??= GoogleSignIn(scopes: const ['email', 'profile']));

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

    await _admit(user);
  }

  /// Emulator-only sign-in as an arbitrary Google identity.
  ///
  /// TEST SCAFFOLDING, and compiled out of a normal build: [Emulators.enabled]
  /// is a `--dart-define`, and this throws if it is ever reached without it.
  /// It exists because `signInWithPopup` does not work against the auth
  /// emulator in an automated browser — the popup navigates in place and the
  /// OAuth handler loses its opener — so there is otherwise no way to drive
  /// this app through a sign-in while verifying a change.
  ///
  /// The emulator accepts a JSON string where a Google ID token belongs and
  /// stamps `sign_in_provider: 'google.com'`, which is what isHuman() in
  /// firestore.rules requires. Admission runs through the same [_admit] as a
  /// real sign-in, so what this exercises is the real gate.
  Future<void> signInAsEmulatorUser(String email, {String? name}) async {
    if (!Emulators.enabled) {
      throw const AuthException('Emulator sign-in is not available.');
    }
    final address = email.trim().toLowerCase();
    final credential = fb_auth.GoogleAuthProvider.credential(
      idToken: jsonEncode({
        'sub': 'emu-$address',
        'email': address,
        'email_verified': true,
        'name': name ?? address.split('@').first,
      }),
    );
    final result = await _auth.signInWithCredential(credential);
    final user = result.user;
    if (user == null) {
      throw const AuthException('Sign-in failed: no user returned.');
    }
    await _admit(user);
  }

  /// Decides whether this account is allowed in, and brings its profile doc up
  /// to date. The single admission path — two copies of this would drift, and
  /// the drift would be someone getting in who shouldn't.
  Future<void> _admit(fb_auth.User user) async {
    final email = (user.email ?? '').toLowerCase();

    // Read the profile BEFORE judging the address, mirroring AuthProvider in
    // src/lib/auth.jsx. Having a /users doc is what admission means now (see
    // isHuman() in firestore.rules): an invited guest's Google address is
    // arbitrary and grants nothing, and their doc is the record of having been
    // let in — so a returning guest must not be turned away for failing a
    // domain check they were never expected to pass.
    //
    // A stranger's read comes back empty, and under rules that predate this it
    // is denied outright; both are indistinguishable from "no doc" and lead to
    // the same rejection below, so the failure is swallowed on purpose.
    final ref = _firestore.collection('users').doc(user.uid);
    DocumentSnapshot<Map<String, dynamic>>? snap;
    try {
      snap = await ref.get();
    } on FirebaseException {
      snap = null;
    }
    final known = snap?.exists ?? false;

    if (!known && !AppConfig.isEmailAllowed(email)) {
      await signOut();
      final extras = AppConfig.allowedExtraEmails.isNotEmpty
          ? ' Some external addresses are also allowed.'
          : '';
      throw AuthException(
        'Only @${AppConfig.allowedEmailDomain} accounts can sign in.$extras'
        ' If you were sent an invite link, open it in a browser first — then'
        ' sign in here.',
      );
    }

    // Removed from the workspace. This has to come before _syncProfile, whose
    // display-field refresh the rules would refuse — leaving a fired employee
    // staring at the permission-denied branch below, which tells them to go
    // check firestore.rules in the Firebase console. Reading your own document
    // while deactivated is specifically allowed so this is reachable at all.
    if (known && snap!.data()?['deactivated'] == true) {
      await signOut();
      throw const AuthException(
        'Your access to this workspace has been removed. Speak to an admin if'
        ' you think that is a mistake.',
      );
    }

    try {
      await _syncProfile(user, email, snap);
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

  /// Takes the snapshot signIn() already read, rather than reading again — the
  /// admission decision and the bootstrap both need it, and it is the one read
  /// every sign-in pays for.
  Future<void> _syncProfile(
    fb_auth.User user,
    String email,
    DocumentSnapshot<Map<String, dynamic>>? snap,
  ) async {
    final ref = _firestore.collection('users').doc(user.uid);
    final isSuper = AppConfig.isBootstrapSuperAdmin(email);

    if (snap == null || !snap.exists) {
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
      final existing = snap.data() ?? const <String, dynamic>{};
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
