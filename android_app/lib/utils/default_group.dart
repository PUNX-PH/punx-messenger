import 'package:cloud_firestore/cloud_firestore.dart';

/// When the app asks the Worker to put a new account into the default group
/// (PUNX TEAM). Mirrors src/lib/onboarding.js (the web app).
///
/// The Worker is the one that decides (workers/src/routes/onboarding.js checks
/// every one of these again: a client is not trusted). This only avoids a
/// pointless request at every sign-in. The two constants are the Worker's,
/// pinned equal by test/utils/default_group_test.dart.
const newAccountDays = 7;
const staffRoles = ['employee', 'admin', 'super_admin', 'developer'];

/// Exactly `name@domain`, in any letter case. A look-alike or longer domain is
/// not the company's, and neither is an externally allowed address.
bool hasCompanyEmail(String? email, String? domain) {
  final d = (domain ?? '').trim().toLowerCase();
  final e = (email ?? '').toLowerCase();
  final at = e.lastIndexOf('@');
  return d.isNotEmpty && at > 0 && e.substring(at + 1) == d;
}

/// Should this sign-in ask the Worker to add the person to the default group?
///
///  - A company address (@punx.ai): an externally allowed one is not added.
///  - Staff, not a guest.
///  - Not already marked (the mark keeps someone who left from being put back).
///  - New: the account was just created now, or in the last [newAccountDays]
///    days. The week lets a first attempt that failed be retried at the next
///    sign-in, while people who were here before this existed are never touched.
bool shouldJoinDefaultGroup({
  required Map<String, dynamic>? profile,
  required String? email,
  required String? domain,
  DateTime? now,
  bool justCreated = false,
}) {
  if (profile == null) return false;
  if (!hasCompanyEmail(email, domain)) return false;
  if (!staffRoles.contains(profile['role'])) return false;
  if (profile['defaultGroupJoinedAt'] != null) return false;
  if (justCreated) return true;

  final created = profile['createdAt'];
  final at = switch (created) {
    Timestamp() => created.millisecondsSinceEpoch,
    DateTime() => created.millisecondsSinceEpoch,
    _ => null,
  };
  if (at == null) return false;
  final nowMs = (now ?? DateTime.now()).millisecondsSinceEpoch;
  return at <= nowMs + const Duration(minutes: 5).inMilliseconds &&
      nowMs - at <= const Duration(days: newAccountDays).inMilliseconds;
}
