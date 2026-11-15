import 'package:cloud_firestore/cloud_firestore.dart';

import 'role.dart';

/// Mirrors the `/users/{uid}` document shape from src/lib/auth.jsx + users.jsx.
class UserProfile {
  final String id; // == Firebase Auth uid
  final String email;
  final String name;
  final String? photoURL;
  final Role role;
  final Timestamp? createdAt;
  final Timestamp? lastSeen;
  final String presence; // 'online' | 'away' | legacy 'idle'
  final Map<String, Timestamp> lastRead; // pathKey -> last-read timestamp
  final List<String> mutedGroups;

  /// Conversations (DMs and single channels) this person has muted, as read keys
  /// (see utils/muted.dart). Their own only: like `lastRead`, it is read from
  /// profileProvider and left out of the shared identity (users_identity.dart).
  final List<String> mutedChats;

  /// Removed from the workspace. isHuman() in firestore.rules refuses a
  /// deactivated account everything, so this is not a display preference — it
  /// is whether the app answers to them at all. Absent reads as active, the
  /// same convention the rules use.
  final bool deactivated;

  const UserProfile({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    this.photoURL,
    this.createdAt,
    this.lastSeen,
    this.presence = 'online',
    this.lastRead = const {},
    this.mutedGroups = const [],
    this.mutedChats = const [],
    this.deactivated = false,
  });

  factory UserProfile.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    return UserProfile.fromMap(doc.id, data);
  }

  factory UserProfile.fromMap(String id, Map<String, dynamic> data) {
    final rawLastRead = data['lastRead'] as Map<String, dynamic>? ?? {};
    return UserProfile(
      id: id,
      email: (data['email'] as String?) ?? '',
      name: (data['name'] as String?) ?? '',
      photoURL: data['photoURL'] as String?,
      role: Role.fromString(data['role'] as String?),
      createdAt: data['createdAt'] as Timestamp?,
      lastSeen: data['lastSeen'] as Timestamp?,
      presence: (data['presence'] as String?) ?? 'online',
      lastRead: rawLastRead.map((k, v) => MapEntry(k, v as Timestamp)),
      mutedGroups: List<String>.from(data['mutedGroups'] as List? ?? const []),
      mutedChats: _cleanMutedChats(data['mutedChats']),
      deactivated: data['deactivated'] == true,
    );
  }
}

/// The entries of a profile's `mutedChats` that are real read keys (`dms__<id>` or
/// `groups__<g>__channels__<c>`). Anything that is not a list of non-empty text is none.
List<String> _cleanMutedChats(Object? raw) => raw is List
    ? [
        for (final k in raw)
          if (k is String && k.isNotEmpty) k,
      ]
    : const [];
