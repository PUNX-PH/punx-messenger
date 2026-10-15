import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/group_invite.dart';

void main() {
  final now = DateTime(2026, 10, 15, 12);
  Timestamp at(DateTime d) => Timestamp.fromDate(d);

  GroupInvite invite({DateTime? expires, bool revoked = false}) => GroupInvite(
    token: 't',
    groupId: 'g',
    expiresAt: expires == null ? null : at(expires),
    revoked: revoked,
  );

  group('liveness', () {
    test('a future expiry that is not revoked is live', () {
      final i = invite(expires: now.add(const Duration(days: 3)));
      expect(i.isLive(now: now), isTrue);
      expect(i.statusLabel(now: now), isNull);
    });

    test('a past expiry is expired', () {
      final i = invite(expires: now.subtract(const Duration(minutes: 1)));
      expect(i.isLive(now: now), isFalse);
      expect(i.statusLabel(now: now), 'Expired');
    });

    test('expiring exactly now counts as expired', () {
      expect(invite(expires: now).isLive(now: now), isFalse);
    });

    test('revoked wins over expired, and over a future expiry', () {
      final future = now.add(const Duration(days: 3));
      final past = now.subtract(const Duration(days: 3));
      expect(invite(expires: future, revoked: true).isLive(now: now), isFalse);
      expect(
        invite(expires: future, revoked: true).statusLabel(now: now),
        'Revoked',
      );
      expect(
        invite(expires: past, revoked: true).statusLabel(now: now),
        'Revoked',
      );
    });

    test('no readable expiry is never live', () {
      expect(invite().isLive(now: now), isFalse);
      expect(invite().expiryLabel(now: now), '');
    });
  });

  group('expiryLabel', () {
    test('says when it ends, or when it ended', () {
      expect(
        invite(expires: DateTime(2026, 10, 22, 9)).expiryLabel(now: now),
        'Expires Oct 22',
      );
      expect(
        invite(expires: DateTime(2026, 10, 8, 9)).expiryLabel(now: now),
        'Expired Oct 8',
      );
    });
  });

  group('fromMap', () {
    test('reads a well-formed invite', () {
      final i = GroupInvite.fromMap('tok', {
        'groupId': 'g1',
        'groupName': 'Test',
        'channelIds': ['c1', 'c2'],
        'channelNames': ['general', 'music'],
        'createdBy': 'u1',
        'expiresAt': at(now),
        'revoked': true,
      });
      expect(i.token, 'tok');
      expect(i.groupId, 'g1');
      expect(i.channelNames, ['general', 'music']);
      expect(i.revoked, isTrue);
    });

    test('wrong-typed fields degrade instead of throwing', () {
      late GroupInvite i;
      expect(
        () => i = GroupInvite.fromMap('tok', {
          'groupId': 7,
          'groupName': false,
          'channelIds': 'c1',
          'channelNames': ['ok', 3, null],
          'createdBy': 1,
          'createdAt': 'yesterday',
          'expiresAt': 'soon',
          'revoked': 'yes',
        }),
        returnsNormally,
      );
      expect(i.groupId, '');
      expect(i.channelIds, isEmpty);
      expect(i.channelNames, ['ok']);
      expect(i.expiresAt, isNull);
      expect(i.revoked, isFalse);
      // And an unreadable expiry must not read as a working link.
      expect(i.isLive(now: now), isFalse);
    });
  });

  test('the day options match the web client', () {
    expect(inviteDayOptions.map((o) => o.days), [1, 7, 30]);
  });
}
