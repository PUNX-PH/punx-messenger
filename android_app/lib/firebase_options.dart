import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

/// Firebase config for platforms that need explicit `FirebaseOptions`.
///
/// Android reads its config from `android/app/google-services.json` via the
/// Google Services Gradle plugin, so it needs no entry here. Web has no such
/// native config file, so it needs explicit options — reusing the same
/// Firebase project's existing "Web app" registration that the React web app
/// (../src/lib/firebase.js) already uses, values taken from ../.env.local.
abstract final class DefaultFirebaseOptions {
  static FirebaseOptions? get currentPlatform => kIsWeb ? web : null;

  static const web = FirebaseOptions(
    apiKey: 'AIzaSyAS38AO06f7V_YlZqBkTymrz6V8el9hrJ0',
    authDomain: 'punx-msg.firebaseapp.com',
    projectId: 'punx-msg',
    storageBucket: 'punx-msg.firebasestorage.app',
    messagingSenderId: '781531419503',
    appId: '1:781531419503:web:def1a4d4da3d5aa913ce9a',
  );
}
