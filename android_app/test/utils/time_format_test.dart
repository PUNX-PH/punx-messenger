import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/utils/time_format.dart';

void main() {
  group('dayLabel', () {
    final now = DateTime(2026, 10, 14, 15, 30); // a Wednesday

    test('today and yesterday are named', () {
      expect(dayLabel(DateTime(2026, 10, 14, 0, 5), now: now), 'Today');
      expect(dayLabel(DateTime(2026, 10, 14, 23, 59), now: now), 'Today');
      expect(dayLabel(DateTime(2026, 10, 13, 23, 59), now: now), 'Yesterday');
    });

    test('earlier this year spells out the day without a year', () {
      expect(dayLabel(DateTime(2026, 3, 4, 9), now: now), 'Wednesday, March 4');
    });

    test('a previous year includes the year', () {
      expect(
        dayLabel(DateTime(2025, 12, 31, 9), now: now),
        'Wednesday, December 31, 2025',
      );
    });

    test('counts calendar days, so late evening is still "Yesterday"', () {
      // 23:59 yesterday is under 24h before 00:30 today, and 47h before the
      // end of today — neither may change the answer.
      final justAfterMidnight = DateTime(2026, 10, 14, 0, 30);
      expect(
        dayLabel(DateTime(2026, 10, 13, 23, 59), now: justAfterMidnight),
        'Yesterday',
      );
      expect(
        dayLabel(DateTime(2026, 10, 12, 0, 1), now: DateTime(2026, 10, 14, 23)),
        isNot(anyOf('Today', 'Yesterday')),
      );
    });
  });

  group('formatClock', () {
    final ts = Timestamp.fromDate(DateTime(2026, 10, 14, 9, 1));

    test('24-hour when the device asks for it', () {
      expect(formatClock(ts, use24h: true), '09:01');
    });

    test('12-hour otherwise, with a day period', () {
      final out = formatClock(ts);
      expect(out, contains('9:01'));
      expect(out, contains('AM'));
    });

    test('no timestamp yet (a pending write) is empty, not an error', () {
      expect(formatClock(null), '');
    });
  });
}
