import 'dart:async';

import 'package:firebase_core/firebase_core.dart';

/// What to show a person when something they just did failed.
///
/// Every screen used to print `'$e'`, which for a refused Firestore call is
/// "[cloud_firestore/permission-denied] The caller does not have permission to
/// execute the specified operation." That says nothing about what failed or what to
/// do. This turns an error into a sentence that names what they were trying to do and
/// says what is likely wrong, with the short error code last for whoever they report
/// it to. Pure, so it is tested.
///
/// [action] finishes "Couldn't ...": for example `send that message` or
/// `create the group`.
String describeError(Object error, {required String action}) {
  if (error is FirebaseException) {
    final code = error.code;
    final text = switch (code) {
      'permission-denied' =>
        "You don't have permission to $action. If that is unexpected, your "
            'access may have changed: sign out and back in, or ask an admin.',
      'unauthenticated' =>
        "You've been signed out, so you can't $action. Sign in again and retry.",
      'unavailable' || 'deadline-exceeded' || 'network-request-failed' =>
        "Couldn't reach the server, so you couldn't $action. Check your "
            'connection and try again.',
      'not-found' =>
        "Couldn't $action: what you were changing no longer exists. It may have "
            'been deleted.',
      'already-exists' => "Couldn't $action: that already exists.",
      'resource-exhausted' =>
        "Too many requests just now, so you couldn't $action. Wait a moment and "
            'try again.',
      _ => "Couldn't $action.",
    };
    return code.isEmpty ? text : '$text ($code)';
  }

  // No connection, or a call that ran out of time, from outside Firebase. A
  // SocketException is recognised by name because importing dart:io for it would
  // stop the app compiling for the web, where that library does not exist.
  if (error is TimeoutException ||
      error.runtimeType.toString() == 'SocketException') {
    return "Couldn't reach the server, so you couldn't $action. Check your "
        'connection and try again.';
  }

  // The app's own checks throw readable messages ("Use 2-32 characters...",
  // "Image must be under 10 MB."). Show those as written, without Dart's prefix.
  if (error is StateError) return _clean(error.message);
  // A RangeError is an ArgumentError too, but it is a bug ("index out of range"),
  // not something the app wrote for a person.
  if (error is ArgumentError &&
      error is! RangeError &&
      error.message is String) {
    return _clean(error.message as String);
  }
  if (error is FormatException) return _clean(error.message);
  if (error is Exception) {
    final text = '$error';
    if (text.startsWith('Exception: ')) return _clean(text.substring(11));
  }

  // Anything else (a platform error, a bug) is not for a person to read.
  return "Couldn't $action.";
}

String _clean(String message) {
  final trimmed = message.trim();
  return trimmed.isEmpty ? 'Something went wrong.' : trimmed;
}
