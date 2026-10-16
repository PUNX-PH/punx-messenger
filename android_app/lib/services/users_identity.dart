import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/presence.dart';
import '../models/user_profile.dart';

// Keeps a person's object the SAME object until something about them that the UI
// shows has changed — the Android half of src/lib/usersIdentity.js.
//
// Why. Every client listens to the whole `users` collection, and every online
// person rewrites their own document every 45 seconds (their `lastSeen`
// heartbeat), plus whenever they go away, come back, or read a channel. Each
// arrived as a fresh snapshot, the lookup tables were rebuilt, and every screen
// watching them rebuilt too — the message list included — to show exactly what
// it showed a second earlier.
//
// So a user document is split in two: WHO they are (name, photo, role, ...), which
// keeps its identity until it really changes, and WHEN they were last around
// ([Presence]), which is published on its own, in batches.

/// A person without the fields that change by themselves.
///
/// `lastRead` is dropped for EVERYONE here, unlike on the web: this app reads its
/// own from profileProvider (a listener on its own document), never from this list.
UserProfile identityOf(UserProfile u) => UserProfile(
  id: u.id,
  email: u.email,
  name: u.name,
  photoURL: u.photoURL,
  role: u.role,
  createdAt: u.createdAt,
  mutedGroups: u.mutedGroups,
  deactivated: u.deactivated,
  // lastSeen, presence and lastRead are left at their defaults ON PURPOSE: anything
  // still reading them off this object gets nothing, not a value frozen at
  // whenever the object was first made. Read presence from [Presence].
);

Presence presenceOf(UserProfile u) =>
    Presence(presence: u.presence, lastSeen: u.lastSeen);

/// Text that is equal exactly when two identities show the same thing.
String identityKey(UserProfile u) {
  int? ms(Timestamp? t) => t?.millisecondsSinceEpoch;
  return [
    u.id,
    u.email,
    u.name,
    u.photoURL,
    u.role.name,
    ms(u.createdAt),
    u.deactivated,
    u.mutedGroups.join('\u0001'),
  ].join('\u0000');
}

typedef IdentityEntry = ({String key, UserProfile user});

/// Result of [shareIdentity].
typedef SharedUsers = ({
  List<UserProfile> users,
  Map<String, IdentityEntry> next,
  Map<String, Presence> presence,
});

/// Turns a snapshot's users into identity-stable users plus a presence map.
///
/// For everyone whose identity did not change, `users` holds the very object from
/// [previous], so `identical()` says "nothing to rebuild".
SharedUsers shareIdentity(
  Map<String, IdentityEntry> previous,
  List<UserProfile> raw,
) {
  final next = <String, IdentityEntry>{};
  final users = <UserProfile>[];
  final presence = <String, Presence>{};
  for (final doc in raw) {
    presence[doc.id] = presenceOf(doc);
    final identity = identityOf(doc);
    final key = identityKey(identity);
    final before = previous[doc.id];
    final user = (before != null && before.key == key) ? before.user : identity;
    next[doc.id] = (key: key, user: user);
    users.add(user);
  }
  return (users: users, next: next, presence: presence);
}

/// Same people, in the same order, as the same objects?
bool sameUsers(List<UserProfile> a, List<UserProfile> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (!identical(a[i], b[i])) return false;
  }
  return true;
}
