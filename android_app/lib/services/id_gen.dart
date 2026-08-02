import 'dart:math';

const _chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
final _random = Random.secure();

/// 20-char Firestore-compatible id, mirrors storage.js's newId(). Used to
/// pre-allocate a group id before batch-creating the group + its #general
/// channel.
String newId() {
  return List.generate(
    20,
    (_) => _chars[_random.nextInt(_chars.length)],
  ).join();
}
