import '../models/dnd.dart';
import '../models/user_profile.dart';

// Switching do-not-disturb on and showing how long it has left: mirrors the rest of src/lib/dnd.js
// (the reading side is in models/dnd.dart).
//
// It is quiet, not blocked: messages still arrive and still count as unread (muting a conversation
// is what stops that), and a call still rings. It only stops the in-app ping and the system
// notification, for DMs and for @mentions alike.

/// How long it lasts. The ids are what [dndUntil] understands, and what the web calls them.
const List<({String id, String label})> dndOptions = [
  (id: '30m', label: '30 minutes'),
  (id: '1h', label: '1 hour'),
  (id: '4h', label: '4 hours'),
  (id: 'morning', label: 'Until 8:00 in the morning'),
  (id: 'never', label: 'Until I turn it off'),
];

/// The hour "the morning" means.
const int morningHour = 8;

/// When do-not-disturb with this choice ends: milliseconds since 1970, or null for "until I turn it
/// off" (and for anything unknown).
int? dndUntil(String id, DateTime now) {
  final ms = now.millisecondsSinceEpoch;
  switch (id) {
    case '30m':
      return ms + 30 * Duration.millisecondsPerMinute;
    case '1h':
      return ms + Duration.millisecondsPerHour;
    case '4h':
      return ms + 4 * Duration.millisecondsPerHour;
    case 'morning':
      // The next 8:00 by the person's own clock: this morning if it is not 8 yet, else tomorrow.
      // Built from the calendar date (not "+ 24 hours"), so a day with the clocks changing is right.
      final today = DateTime(now.year, now.month, now.day, morningHour);
      final next = today.millisecondsSinceEpoch <= ms
          ? DateTime(now.year, now.month, now.day + 1, morningHour)
          : today;
      return next.millisecondsSinceEpoch;
    default:
      return null;
  }
}

/// What to store for a choice.
Map<String, Object?> buildDnd(String id, DateTime now) => {'until': dndUntil(id, now)};

/// Is do-not-disturb on for this person right now? Null when it is off, has run out, or what is
/// stored is not usable. Own profile only: nobody else's carries it (users_identity.dart).
Dnd? activeDndOf(UserProfile? user, DateTime now) {
  final d = user?.dnd;
  return d != null && d.isActiveAt(now) ? d : null;
}

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// How long it has left, in words: "until 3:40 PM", "until tomorrow 8:00 AM", "until you turn it
/// off". [formatTime] writes a time of day the way this phone's clock is set (12 or 24 hours).
String dndLabel(Dnd dnd, DateTime now, String Function(DateTime) formatTime) {
  final until = dnd.until;
  if (until == null) return 'until you turn it off';
  final end = DateTime.fromMillisecondsSinceEpoch(until);
  final time = formatTime(end);
  if (_sameDay(end, now)) return 'until $time';
  if (_sameDay(end, DateTime(now.year, now.month, now.day + 1))) {
    return 'until tomorrow $time';
  }
  return 'until ${_weekdays[end.weekday - 1]}, ${_months[end.month - 1]} ${end.day} $time';
}
