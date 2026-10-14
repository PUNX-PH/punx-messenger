import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';

DateTime? _toDate(Timestamp? ts) => ts?.toDate();

bool _isSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// Message-list timestamp format: `HH:mm` if today, else `Mon D, HH:mm` —
/// mirrors MessageList.jsx's formatTime().
String formatMessageTime(Timestamp? ts, {DateTime? now}) {
  final d = _toDate(ts);
  if (d == null) return '';
  final n = now ?? DateTime.now();
  if (_isSameDay(d, n)) return DateFormat.Hm().format(d);
  return '${DateFormat.MMMd().format(d)}, ${DateFormat.Hm().format(d)}';
}

/// Search-result timestamp format: `HH:mm` if today, else just `Mon D` (no
/// time) — mirrors SearchDropdown.jsx's (slightly different) formatTime().
String formatSearchResultTime(Timestamp? ts, {DateTime? now}) {
  final d = _toDate(ts);
  if (d == null) return '';
  final n = now ?? DateTime.now();
  if (_isSameDay(d, n)) return DateFormat.Hm().format(d);
  return DateFormat.MMMd().format(d);
}

/// True when both fall on the same local calendar day.
bool isSameDay(DateTime a, DateTime b) => _isSameDay(a, b);

/// Clock time only — the day lives on the divider above the message, so
/// repeating it on every header just makes each one longer to read. Follows the
/// device's 12/24-hour setting rather than assuming one.
String formatClock(Timestamp? ts, {bool use24h = false}) {
  final d = _toDate(ts);
  if (d == null) return '';
  return (use24h ? DateFormat.Hm() : DateFormat.jm()).format(d);
}

/// "Today", "Yesterday", "Tuesday, March 4" — plus the year when it is not this
/// one. Same wording as dayLabel in src/components/MessageList.jsx.
String dayLabel(DateTime d, {DateTime? now}) {
  final n = now ?? DateTime.now();
  DateTime startOfDay(DateTime x) => DateTime(x.year, x.month, x.day);
  // Calendar-day difference, not 24h blocks: a DST change makes a day 23 or 25
  // hours long, and dividing the raw Duration would mislabel the evening.
  final days = DateTime.utc(
    n.year,
    n.month,
    n.day,
  ).difference(DateTime.utc(d.year, d.month, d.day)).inDays;
  if (days == 0) return 'Today';
  if (days == 1) return 'Yesterday';
  final day = startOfDay(d);
  return day.year == n.year
      ? DateFormat('EEEE, MMMM d').format(day)
      : DateFormat('EEEE, MMMM d, y').format(day);
}
