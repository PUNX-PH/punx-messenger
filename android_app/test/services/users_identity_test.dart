import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/services/users_identity.dart';

Timestamp ts(int ms) => Timestamp.fromMillisecondsSinceEpoch(ms);

UserProfile ana({
  String name = 'Ana',
  Role role = Role.employee,
  String? photo = 'a.png',
  bool deactivated = false,
  int lastSeen = 5000,
  String presence = 'online',
  Map<String, Timestamp>? lastRead,
  List<String> muted = const [],
}) => UserProfile(
  id: 'ana',
  email: 'ana@punx.ai',
  name: name,
  role: role,
  photoURL: photo,
  createdAt: ts(1000),
  lastSeen: ts(lastSeen),
  presence: presence,
  lastRead: lastRead ?? {'c1': ts(10)},
  mutedGroups: muted,
  deactivated: deactivated,
);

UserProfile ben({int lastSeen = 6000, String presence = 'away'}) => UserProfile(
  id: 'ben',
  email: 'ben@punx.ai',
  name: 'Ben',
  role: Role.admin,
  createdAt: ts(2000),
  lastSeen: ts(lastSeen),
  presence: presence,
);

void main() {
  group('identityOf', () {
    test('drops presence, lastSeen and lastRead', () {
      final id = identityOf(ana());
      expect(id.lastSeen, isNull);
      expect(id.presence, 'online'); // the model default — NOT Ana's value
      expect(id.lastRead, isEmpty);
      expect(id.name, 'Ana');
      expect(id.role, Role.employee);
    });

    test('presenceOf is exactly the presence slice', () {
      final p = presenceOf(ana(lastSeen: 7000, presence: 'away'));
      expect(p.presence, 'away');
      expect(p.lastSeen!.millisecondsSinceEpoch, 7000);
    });
  });

  group('shareIdentity', () {
    test('a heartbeat changes nothing a screen can see: same objects', () {
      final first = shareIdentity({}, [ana(), ben()]);
      final second = shareIdentity(first.next, [
        ana(lastSeen: 50000),
        ben(lastSeen: 51000, presence: 'online'),
      ]);
      expect(identical(second.users[0], first.users[0]), isTrue);
      expect(identical(second.users[1], first.users[1]), isTrue);
      expect(sameUsers(first.users, second.users), isTrue);
    });

    test('...but the presence map carries the new values', () {
      final first = shareIdentity({}, [ana(), ben()]);
      final second = shareIdentity(first.next, [
        ana(),
        ben(lastSeen: 51000, presence: 'online'),
      ]);
      expect(second.presence['ben']!.presence, 'online');
      expect(second.presence['ben']!.lastSeen!.millisecondsSinceEpoch, 51000);
      expect(
        first.presence['ben']!.presence,
        'away',
        reason: 'old map untouched',
      );
    });

    test("anybody reading a channel is not news", () {
      final first = shareIdentity({}, [ana(), ben()]);
      final second = shareIdentity(first.next, [
        ana(lastRead: {'c1': ts(99), 'c2': ts(99)}),
        ben(),
      ]);
      expect(sameUsers(first.users, second.users), isTrue);
    });

    test('a name, photo, role or mute change replaces exactly that person', () {
      final first = shareIdentity({}, [ana(), ben()]);
      for (final changed in [
        ana(name: 'Anna'),
        ana(photo: 'b.png'),
        ana(role: Role.superAdmin),
        ana(muted: ['g1']),
      ]) {
        final second = shareIdentity(first.next, [changed, ben()]);
        expect(identical(second.users[0], first.users[0]), isFalse);
        expect(
          identical(second.users[1], first.users[1]),
          isTrue,
          reason: 'Ben is untouched',
        );
      }
    });

    test('being deactivated, or reactivated, is a change', () {
      final first = shareIdentity({}, [ana(), ben()]);
      final off = shareIdentity(first.next, [ana(deactivated: true), ben()]);
      expect(identical(off.users[0], first.users[0]), isFalse);
      expect(off.users[0].deactivated, isTrue);
      final back = shareIdentity(off.next, [ana(), ben()]);
      expect(identical(back.users[0], off.users[0]), isFalse);
      expect(back.users[0].deactivated, isFalse);
    });

    test('equal timestamps in different objects are the same value', () {
      final first = shareIdentity({}, [ana()]);
      final second = shareIdentity(first.next, [ana()]);
      expect(identical(second.users[0], first.users[0]), isTrue);
    });

    test('people leaving and joining the list are handled', () {
      final first = shareIdentity({}, [ana(), ben()]);
      final gone = shareIdentity(first.next, [ben()]);
      expect(gone.users.map((u) => u.id), ['ben']);
      expect(identical(gone.users[0], first.users[1]), isTrue);
      expect(gone.next.containsKey('ana'), isFalse, reason: 'nothing leaks');
      final more = shareIdentity(gone.next, [
        ben(),
        UserProfile(
          id: 'cal',
          email: 'c@punx.ai',
          name: 'Cal',
          role: Role.guest,
        ),
      ]);
      expect(sameUsers(gone.users, more.users), isFalse);
    });

    test('a new order of the same people is not "the same users"', () {
      final first = shareIdentity({}, [ana(), ben()]);
      final second = shareIdentity(first.next, [ben(), ana()]);
      expect(sameUsers(first.users, second.users), isFalse);
    });

    test('a large directory is cheap to process', () {
      final list = [
        for (var i = 0; i < 2000; i++)
          UserProfile(
            id: 'u$i',
            email: 'u$i@punx.ai',
            name: 'User $i',
            role: Role.employee,
            lastSeen: ts(i),
          ),
      ];
      final first = shareIdentity({}, list);
      final beat = [
        for (final u in list)
          UserProfile(
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            lastSeen: ts(u.lastSeen!.millisecondsSinceEpoch + 1),
          ),
      ];
      final watch = Stopwatch()..start();
      final second = shareIdentity(first.next, beat);
      watch.stop();
      expect(sameUsers(first.users, second.users), isTrue);
      expect(
        watch.elapsedMilliseconds,
        lessThan(250),
        reason: '2000 heartbeats took ${watch.elapsedMilliseconds}ms',
      );
    });
  });
}
