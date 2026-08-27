import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Local Firebase emulator wiring, mirroring the `VITE_USE_EMULATORS` block in
/// `src/lib/firebase.js` and the values in `.env.emulator.local`.
///
/// Opt-in, and inert in any normal build:
///
///   flutter run -d web-server --web-port 8765 --dart-define=USE_EMULATORS=1
///
/// Two things make it impossible for a test run to reach the live workspace,
/// and both matter:
///
///  1. It initialises Firebase with the **`demo-punx`** project rather than the
///     real `punx-msg` from `firebase_options.dart`. A project id starting with
///     `demo-` has no Firebase project behind it at all, so the SDK cannot
///     reach a real backend even if the emulator connection below were skipped.
///  2. [connect] refuses to run unless it sees that prefix.
///
/// Ports match the `emulators` block in `firebase.json`, which the web app
/// already uses: auth 9099, firestore 8080.
abstract final class Emulators {
  static const enabled = bool.fromEnvironment('USE_EMULATORS');

  static const _projectId = 'demo-punx';
  static const _host = 'localhost';
  static const _authPort = 9099;
  static const _firestorePort = 8080;

  /// Deliberately fake, and identical to `.env.emulator.local` so both clients
  /// share one emulated workspace.
  static const options = FirebaseOptions(
    apiKey: 'demo-api-key',
    appId: '1:000000000000:web:demoemulator',
    messagingSenderId: '000000000000',
    projectId: _projectId,
    authDomain: '$_projectId.firebaseapp.com',
    storageBucket: '$_projectId.appspot.com',
  );

  /// Call once, immediately after `Firebase.initializeApp`.
  static Future<void> connect() async {
    if (!enabled) return;

    final id = Firebase.app().options.projectId;
    if (!id.startsWith('demo-')) {
      throw StateError(
        'Refusing to enter emulator mode against project "$id". Emulator runs '
        'must be initialised with Emulators.options, whose demo- project id is '
        'what keeps a test run away from the live workspace.',
      );
    }

    await FirebaseAuth.instance.useAuthEmulator(_host, _authPort);
    FirebaseFirestore.instance.useFirestoreEmulator(_host, _firestorePort);
    debugPrint('[firebase] emulator mode: $id');
  }
}
