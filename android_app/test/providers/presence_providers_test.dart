import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/utils/constants.dart';

UserProfile _userAt(int lastSeenMs, {String presence = 'online'}) =>
    UserProfile(
      id: 'u1',
      email: 'u1@punx.ai',
      name: 'U1',
      role: Role.employee,
      presence: presence,
      lastSeen: Timestamp.fromMillisecondsSinceEpoch(lastSeenMs),
    );

void main() {
  group('computeStatus', () {
    test('offline when no user', () {
      expect(
        computeStatus(null, DateTime.fromMillisecondsSinceEpoch(1000)),
        'offline',
      );
    });

    test('online when presence is online and lastSeen is fresh', () {
      final now = DateTime.fromMillisecondsSinceEpoch(100000);
      final user = _userAt(99000, presence: 'online');
      expect(computeStatus(user, now), 'online');
    });

    test(
      'away when presence is away (or legacy idle) and lastSeen is fresh',
      () {
        final now = DateTime.fromMillisecondsSinceEpoch(100000);
        expect(computeStatus(_userAt(99000, presence: 'away'), now), 'away');
        expect(computeStatus(_userAt(99000, presence: 'idle'), now), 'away');
      },
    );

    test(
      'offline once lastSeen is stale beyond the offline threshold, regardless of presence field',
      () {
        final now = DateTime.fromMillisecondsSinceEpoch(1000000);
        final staleUser = _userAt(
          1000000 - AppTiming.offlineAfterMs - 1,
          presence: 'online',
        );
        expect(computeStatus(staleUser, now), 'offline');
      },
    );

    test('still online right at the offline threshold boundary', () {
      final now = DateTime.fromMillisecondsSinceEpoch(1000000);
      final boundaryUser = _userAt(
        1000000 - AppTiming.offlineAfterMs,
        presence: 'online',
      );
      expect(computeStatus(boundaryUser, now), 'online');
    });
  });
}
