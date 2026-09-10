import 'dart:convert';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:crypto/crypto.dart';

/// One capability a bot can be granted. Port of `BOT_SCOPES` in
/// src/lib/bots.js — ids must match that list and `botCan()` in
/// firestore.rules exactly, since those are what actually enforce them.
class BotScope {
  const BotScope(this.id, this.label, this.hint);
  final String id;
  final String label;
  final String hint;
}

const botScopes = <BotScope>[
  BotScope('messages:write', 'Post messages',
      'Send, edit and delete its own messages in channels it can see.'),
  BotScope('reactions:write', 'React and pin',
      'Add emoji reactions, and pin or unpin messages.'),
  BotScope('dm:write', 'Direct messages',
      'Start a DM with someone and send them messages.'),
  BotScope('voice:join', 'Join voice channels',
      'Connect to voice channels as a participant. Required for music playback.'),
  BotScope('channels:manage', 'Manage channels',
      'Create, rename and delete channels and categories.'),
  BotScope('members:manage', 'Manage members',
      'Add and remove group members. Cannot touch admins or ownership.'),
];

/// A bot in the registry. Only the fields this UI needs.
class Bot {
  const Bot({
    required this.uid,
    required this.name,
    required this.description,
    required this.scopes,
    required this.enabled,
  });

  factory Bot.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return Bot(
      uid: doc.id,
      name: d['name'] as String? ?? '',
      description: d['description'] as String? ?? '',
      scopes: List<String>.from(d['scopes'] as List? ?? const []),
      enabled: d['enabled'] as bool? ?? false,
    );
  }

  final String uid;
  final String name;
  final String description;
  final List<String> scopes;
  final bool enabled;
}

/// Bot registry management. Port of src/lib/bots.js.
///
/// No Worker involved: creating a bot is pure Firestore, and only the key HASH
/// is ever stored. The Worker's role is minting a Firebase custom token for a
/// bot at runtime (see workers/src/routes/bots.js and docs/BOTS.md), which is a
/// separate flow this file does not touch.
class BotService {
  BotService(this._db);
  final FirebaseFirestore _db;

  /// Byte-identical to the web, and it has to be. The Worker strips this
  /// prefix, splits at the FIRST underscore to recover the bot uid, and
  /// compares sha256(apiKey) against the stored hash with a timing-safe check.
  /// A key built any other way authenticates nowhere.
  static const _keyPrefix = 'punxbot_';

  /// 32 bytes of CSPRNG as lowercase hex, matching randomSecret() on the web.
  /// Random.secure() rather than Random(): this is a credential.
  static String _randomSecret([int byteLength = 32]) {
    final rnd = Random.secure();
    return List.generate(
      byteLength,
      (_) => rnd.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  static String _sha256Hex(String s) =>
      sha256.convert(utf8.encode(s)).toString();

  /// The bot uid must contain NO underscore, because the Worker recovers it by
  /// splitting the key at the first one. Firestore auto-ids are alphanumeric,
  /// so taking one here is what keeps that safe.
  String _newBotUid() => _db.collection('bots').doc().id;

  DocumentReference<Map<String, dynamic>> _bot(String uid) =>
      _db.collection('bots').doc(uid);

  DocumentReference<Map<String, dynamic>> _credentials(String uid) =>
      _bot(uid).collection('private').doc('credentials');

  Stream<List<Bot>> listenBots() {
    return _db
        .collection('bots')
        .orderBy('createdAt')
        .snapshots()
        .map((snap) => snap.docs.map(Bot.fromDoc).toList());
  }

  /// Returns the plaintext API key ONCE. Only its hash is stored, so a key
  /// that is not copied now is unrecoverable — rotating is the only remedy.
  Future<({String botUid, String apiKey})> createBot({
    required String name,
    required String description,
    required Iterable<String> scopes,
    required String createdBy,
  }) async {
    final botUid = _newBotUid();
    final apiKey = '$_keyPrefix${botUid}_${_randomSecret()}';
    final cleanName = name.trim();
    final valid = botScopes.map((s) => s.id).toSet();

    final batch = _db.batch();
    batch.set(_bot(botUid), {
      'uid': botUid,
      'name': cleanName,
      'description': description.trim(),
      'scopes': scopes.where(valid.contains).toList(),
      'enabled': true,
      'commands': const [], // Phase 3 — slash commands the bot publishes
      'createdAt': FieldValue.serverTimestamp(),
      'createdBy': createdBy,
    });
    batch.set(_credentials(botUid), {
      'keyHash': _sha256Hex(apiKey),
      'rotatedAt': FieldValue.serverTimestamp(),
    });
    // The mirror /users doc is what lets the rest of the app stay completely
    // unaware that bots exist: message authors, member lists and voice tiles
    // all resolve uids through the users directory and will find this.
    batch.set(_db.collection('users').doc(botUid), {
      'uid': botUid,
      'name': cleanName,
      'email': null,
      'photoURL': null,
      'role': 'employee', // a bot's power comes from scopes, never a role
      'type': 'bot',
      'botOwnerUid': createdBy,
      'createdAt': FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return (botUid: botUid, apiKey: apiKey);
  }

  /// Issue a fresh key and invalidate the old one. Returned once, as above.
  Future<String> rotateBotKey(String botUid) async {
    final apiKey = '$_keyPrefix${botUid}_${_randomSecret()}';
    // A full-payload set over an existing doc, which is normally the trap that
    // gets refused — but `bots/{uid}/private/{doc}` is governed by
    // `allow write: if canManageBots()`, covering update with no field
    // restriction, so this one is genuinely safe.
    await _credentials(botUid).set({
      'keyHash': _sha256Hex(apiKey),
      'rotatedAt': FieldValue.serverTimestamp(),
    });
    return apiKey;
  }

  Future<void> setBotEnabled(String botUid, bool enabled) async {
    await _bot(botUid).update({'enabled': enabled});
    // Mirrored onto the users doc as the same `deactivated` flag people carry,
    // so one client-side filter hides both a removed person and a switched-off
    // bot. Cosmetic for a bot — the line above is what the rules actually read.
    //
    // DELETES the field when enabling rather than writing false, matching the
    // web's deleteField(). Not interchangeable: an absent field and a present
    // `false` differ to anything testing presence rather than truthiness, and
    // the two clients must leave the document in the same shape.
    await _db.collection('users').doc(botUid).update({
      'deactivated': enabled ? FieldValue.delete() : true,
    });
  }

  Future<void> setBotScopes(String botUid, Iterable<String> scopes) async {
    final valid = botScopes.map((s) => s.id).toSet();
    await _bot(botUid).update({
      'scopes': scopes.where(valid.contains).toList(),
    });
  }
}
