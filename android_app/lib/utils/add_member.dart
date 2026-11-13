import '../models/group.dart';
import '../models/user_profile.dart';

/// May this person add people to this group? Workspace admins, the group's
/// admins, and its owner (the owner is also in `adminUids`, which is what
/// firestore.rules checks, so this is the same rule the server enforces).
/// False when either is not known yet, so the button never shows early.
bool canAddMembers({
  required bool workspaceAdmin,
  required String? uid,
  required Group? group,
}) {
  if (uid == null || group == null) return false;
  return workspaceAdmin || group.isAdmin(uid) || group.isOwner(uid);
}

/// Who can be offered: people with a live account who are not in the group
/// yet, by name. A removed account is never offered (the rules refuse it
/// anything, so adding it would only leave a name nobody can use).
List<UserProfile> addableUsers(Group group, Iterable<UserProfile> users) {
  final out = users
      .where((u) => !u.deactivated && !group.memberUids.contains(u.id))
      .toList();
  out.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  return out;
}
