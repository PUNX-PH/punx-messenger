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
