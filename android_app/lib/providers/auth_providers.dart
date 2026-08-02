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
