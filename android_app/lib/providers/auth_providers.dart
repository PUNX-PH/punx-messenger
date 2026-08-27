import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/user_profile.dart';
import '../services/auth_service.dart';

final authServiceProvider = Provider<AuthService>((ref) => AuthService());

/// Raw Firebase Auth user, or null when signed out.
final authStateProvider = StreamProvider<fb_auth.User?>((ref) {
  return ref.watch(authServiceProvider).authStateChanges();
});

/// Live `/users/{uid}` profile doc for the signed-in user, or null.
/// Mirrors the `profile` half of auth.jsx's AuthProvider state.
final profileProvider = StreamProvider<UserProfile?>((ref) {
  final authState = ref.watch(authStateProvider);
  final user = authState.valueOrNull;
  if (user == null) return Stream.value(null);

  return FirebaseFirestore.instance
      .collection('users')
      .doc(user.uid)
      .snapshots()
      .map((snap) => snap.exists ? UserProfile.fromDoc(snap) : null);
});

/// Why the last session ended, when it wasn't the user's own doing. Set by
/// [removalWatcherProvider] and by AuthService when it turns a sign-in away,
/// and rendered by LoginScreen — without it a removed account is dumped back
/// on the sign-in button with no explanation.
final sessionEndedReasonProvider = StateProvider<String?>((ref) => null);

/// Signs the user out the moment they are removed from the workspace.
///
/// profileProvider is a live snapshot on their own document, which is a real
/// advantage over the web (src/lib/auth.jsx reads it once at sign-in), so a
/// removal takes effect immediately rather than at next launch. The document
/// stays readable to its owner while deactivated — firestore.rules allows
/// exactly that — so this listener keeps working after every other read has
/// started being refused.
///
/// Kept alive by PunxApp; it does nothing until the flag actually flips.
final removalWatcherProvider = Provider<void>((ref) {
  ref.listen<bool>(
    profileProvider.select((p) => p.valueOrNull?.deactivated ?? false),
    (was, isRemoved) async {
      if (!isRemoved) return;
      ref.read(sessionEndedReasonProvider.notifier).state =
          'Your access to this workspace has been removed. Speak to an admin if'
    ' you think that is a mistake.';
      await ref.read(authServiceProvider).signOut();
    },
  );
});

enum AuthStatus { loading, signedOut, ready }

/// Coarse-grained session status for router redirects. Deliberately collapses
/// profileProvider's frequent field-level changes (e.g. presence heartbeat
/// writes) down to just "do we have a profile yet" so the router isn't
/// rebuilt on every Firestore doc update — mirrors auth.jsx's Gate, which
/// only cares about `loading` / `!user || !profile` / signed-in-with-profile.
final authStatusProvider = Provider<AuthStatus>((ref) {
  final authAsync = ref.watch(authStateProvider);
  return authAsync.when(
    data: (user) {
      if (user == null) return AuthStatus.signedOut;
      final hasProfile = ref.watch(
        profileProvider.select((p) => p.valueOrNull != null),
      );
      return hasProfile ? AuthStatus.ready : AuthStatus.loading;
    },
    loading: () => AuthStatus.loading,
    error: (_, _) => AuthStatus.signedOut,
  );
});
