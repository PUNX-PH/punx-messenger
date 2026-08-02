/// Sign-in restriction config, mirroring the constants enforced in
/// firestore.rules (`isBootstrapSuperAdmin`, `signedIn`) and previously
/// configured via VITE_* env vars in the web app's src/lib/firebase.js.
///
/// These are not secrets — the same values are already committed in
/// firestore.rules, which is the actual enforcement boundary. This file
/// must stay in sync with that file's `signedIn()`/`isBootstrapSuperAdmin()`.
abstract final class AppConfig {
  static const allowedEmailDomain = 'punx.ai';
  static const allowedExtraEmails = ['perezjohnrey43@gmail.com'];
  static const superAdminEmails = ['rey@punx.ai'];

  static bool isEmailAllowed(String email) {
    final e = email.toLowerCase();
    return e.endsWith('@$allowedEmailDomain') || allowedExtraEmails.contains(e);
  }

  static bool isBootstrapSuperAdmin(String email) {
    return superAdminEmails.contains(email.toLowerCase());
  }

  /// WebRTC ICE servers for 1:1 calling (see services/webrtc_service.dart).
  /// STUN-only by default, mirrors web's VITE_ICE_SERVERS fallback. If a
  /// TURN relay is added later, pass its credentials via `--dart-define`
  /// (read with String.fromEnvironment) rather than hardcoding them here —
  /// unlike the values above, TURN credentials genuinely are secrets.
  static const iceServers = [
    {'urls': 'stun:stun.l.google.com:19302'},
  ];
}
