import '../models/custom_status.dart';
import '../models/user_profile.dart';

// Setting and showing a custom status: mirrors the rest of src/lib/status.js (the reading side is
// in models/custom_status.dart).

/// Ready-made statuses, for one tap.
const List<String> statusPresets = [
  'In a meeting',
  'On leave',
  'Out sick',
  'Working remotely',
  'Heads down',
];

/// How long a status stays. The ids are what [expiryAt] understands.
const List<({String id, String label})> expiryOptions = [
  (id: 'today', label: 'Today'),
  (id: '1h', label: '1 hour'),
  (id: '4h', label: '4 hours'),
  (id: '7d', label: '7 days'),
  (id: 'never', label: "Don't clear"),
];

/// When a status with this choice of expiry ends: milliseconds since 1970, or null for never
/// (and for anything unknown).
int? expiryAt(String id, DateTime now) {
  const hour = Duration.millisecondsPerHour;
  switch (id) {
    case '1h':
      return now.millisecondsSinceEpoch + hour;
    case '4h':
      return now.millisecondsSinceEpoch + 4 * hour;
    case '7d':
      return now.millisecondsSinceEpoch + 7 * 24 * hour;
    case 'today':
      // The end of the person's own day.
      return DateTime(now.year, now.month, now.day, 23, 59, 59, 999)
          .millisecondsSinceEpoch;
    default:
      return null;
  }
}

/// What to store for the text and expiry the person chose, or null when there is nothing to store
/// (clear it).
Map<String, Object?>? buildStatus(String text, String expiryId, DateTime now) {
  final clean = cleanStatusText(text);
  return clean.isEmpty
      ? null
      : {'text': clean, 'until': expiryAt(expiryId, now)};
}

/// The status to SHOW for someone, or null when they have none, it has expired, or what is stored
/// is not usable. Safe to call on anybody's profile.
CustomStatus? activeStatusOf(UserProfile? user, DateTime now) {
  final s = user?.customStatus;
  return s != null && s.isActiveAt(now) ? s : null;
}
