import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/presence.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/providers/users_providers.dart';
import 'package:punx_messenger/services/users_repository.dart';

Timestamp ts(int ms) => Timestamp.fromMillisecondsSinceEpoch(ms);
Presence online(int ms) => Presence(presence: 'online', lastSeen: ts(ms));

/// A Firestore stand-in: hands out whatever the test pushes.
class _FakeUsersRepo implements UsersRepository {
  final controller = StreamController<List<UserProfile>>();
  @override
  Stream<List<UserProfile>> listenUsers() => controller.stream;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

UserProfile user(
  String id, {
  String? name,
  int lastSeen = 0,
  String presence = 'online',
}) => UserProfile(
  id: id,
  email: '$id@punx.ai',
  name: name ?? id.toUpperCase(),
  role: Role.employee,
  lastSeen: ts(lastSeen),
  presence: presence,
);

/// The store's current value, read without the deprecated debugState.
Map<String, Presence> stateOf(PresenceStore store) {
  late Map<String, Presence> value;
  // The listener fires once straight away with the current state; then unsubscribe.
  store.addListener((v) => value = v)();
  return value;
}

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 10));

void main() {
  group('Presence', () {
    test(
      'compares by value, so unchanged presence does not rebuild anyone',
      () {
        expect(online(100), online(100));
        expect(online(100).hashCode, online(100).hashCode);
        expect(online(100) == online(101), isFalse);
        expect(
          online(100) == Presence(presence: 'away', lastSeen: ts(100)),
          isFalse,
        );
      },
    );
  });

  group('PresenceStore', () {
    test(
      'publishes immediately when asked, replacing a waiting batch',
      () async {
        final store = PresenceStore(const Duration(milliseconds: 40));
        store.publish({'a': online(1)});
        store.publish({'a': online(2)}, immediate: true);
        expect(stateOf(store)['a'], online(2));
        await Future<void>.delayed(const Duration(milliseconds: 80));
        expect(
          stateOf(store)['a'],
          online(2),
          reason: 'the stale batch must not follow',
        );
        store.dispose();
      },
    );

    test(
      'batches: many updates inside the window become one, the newest',
      () async {
        final store = PresenceStore(const Duration(milliseconds: 60));
        var notifications = 0;
        store.addListener((_) => notifications++, fireImmediately: false);
        for (var i = 1; i <= 25; i++) {
          store.publish({'a': online(i)});
        }
        expect(notifications, 0, reason: 'nothing goes out inside the window');
        await Future<void>.delayed(const Duration(milliseconds: 140));
        expect(notifications, 1, reason: '25 heartbeats, one publish');
        expect(stateOf(store)['a'], online(25));
        store.dispose();
      },
    );

    test('a later batch gets its own window', () async {
      final store = PresenceStore(const Duration(milliseconds: 40));
      store.publish({'a': online(1)});
      await Future<void>.delayed(const Duration(milliseconds: 90));
      store.publish({'a': online(2)});
      await Future<void>.delayed(const Duration(milliseconds: 90));
      expect(stateOf(store)['a'], online(2));
      store.dispose();
    });

    test('disposing with a batch waiting does not throw or publish', () async {
      final store = PresenceStore(const Duration(milliseconds: 30));
      store.publish({'a': online(1)});
      store.dispose();
      await Future<void>.delayed(const Duration(milliseconds: 80));
      // Reaching here without "setState after dispose" is the assertion.
    });
  });

  group('statusOfProvider', () {
    ProviderContainer make() {
      final c = ProviderContainer(
        overrides: [
          tickNowProvider.overrideWith((ref) => const Stream<DateTime>.empty()),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    test('answers from presence, and offline when there is none', () {
      final now = DateTime.now().millisecondsSinceEpoch;
      final c = make();
      c.read(presenceStoreProvider.notifier).publish({
        'a': online(now),
      }, immediate: true);
      expect(c.read(statusOfProvider('a')), 'online');
      expect(c.read(statusOfProvider('nobody')), 'offline');
    });

    test(
      'someone ELSE\'s heartbeat does not rebuild this person\'s row',
      () async {
        final now = DateTime.now().millisecondsSinceEpoch;
        final c = make();
        final store = c.read(presenceStoreProvider.notifier);
        store.publish({'a': online(now), 'b': online(now)}, immediate: true);

        var aRebuilds = 0, bRebuilds = 0;
        c.listen(statusOfProvider('a'), (_, _) => aRebuilds++);
        c.listen(statusOfProvider('b'), (_, _) => bRebuilds++);

        // Only B's lastSeen moves. 'online' stays 'online', so even B's STATUS is
        // unchanged and nothing downstream rebuilds.
        store.publish({
          'a': online(now),
          'b': online(now + 45000),
        }, immediate: true);
        await c
            .pump(); // listeners are told on a microtask: count only after it
        expect(aRebuilds, 0);
        expect(
          bRebuilds,
          0,
          reason: 'a status that did not change is not news',
        );
      },
    );

    test(
      'a real change (online -> away) does rebuild that person only',
      () async {
        final now = DateTime.now().millisecondsSinceEpoch;
        final c = make();
        final store = c.read(presenceStoreProvider.notifier);
        store.publish({'a': online(now), 'b': online(now)}, immediate: true);
        var aRebuilds = 0, bRebuilds = 0;
        c.listen(statusOfProvider('a'), (_, _) => aRebuilds++);
        c.listen(statusOfProvider('b'), (_, _) => bRebuilds++);
        store.publish({
          'a': online(now),
          'b': Presence(presence: 'away', lastSeen: ts(now)),
        }, immediate: true);
        await c.pump();
        expect(aRebuilds, 0);
        expect(bRebuilds, 1);
        expect(c.read(statusOfProvider('b')), 'away');
      },
    );
  });

  group('the whole path: Firestore snapshot -> directory -> screens', () {
    late _FakeUsersRepo repo;
    late ProviderContainer container;

    setUp(() {
      repo = _FakeUsersRepo();
      container = ProviderContainer(
        overrides: [
          usersRepositoryProvider.overrideWithValue(repo),
          presenceStoreProvider.overrideWith(
            (ref) => PresenceStore(const Duration(milliseconds: 70)),
          ),
          tickNowProvider.overrideWith((ref) => const Stream<DateTime>.empty()),
        ],
      );
      addTearDown(() async {
        container.dispose();
        await repo.controller.close();
      });
    });

    List<UserProfile> everyone({int heartbeat = 0, String renameU3 = 'U3'}) => [
      for (var i = 0; i < 10; i++)
        user(
          'u$i',
          name: i == 3 ? renameU3 : null,
          lastSeen: 1000 + i + heartbeat,
        ),
    ];

    test(
      '20 heartbeats rebuild the directory zero times; a rename rebuilds it once',
      () async {
        var directoryRebuilds = 0, listRebuilds = 0;
        container.listen(usersByIdProvider, (_, _) => directoryRebuilds++);
        container.listen(activeUsersProvider, (_, _) => listRebuilds++);

        repo.controller.add(everyone());
        await settle();
        expect(container.read(usersByIdProvider).length, 10);
        final firstLoad = (directoryRebuilds, listRebuilds);
        expect(firstLoad.$1, greaterThan(0));

        for (var i = 1; i <= 20; i++) {
          repo.controller.add(everyone(heartbeat: i * 45000));
          await Future<void>.delayed(const Duration(milliseconds: 2));
        }
        expect(
          (directoryRebuilds, listRebuilds),
          firstLoad,
          reason:
              '20 heartbeats must not reach anything watching the directory',
        );

        repo.controller.add(everyone(heartbeat: 900000, renameU3: 'Renamed'));
        await settle();
        expect(container.read(usersByIdProvider)['u3']!.name, 'Renamed');
        expect(
          directoryRebuilds,
          firstLoad.$1 + 1,
          reason: 'one real change, one rebuild',
        );
      },
    );

    test(
      '...and the heartbeats still arrive, as presence, after the batch window',
      () async {
        container.listen(usersByIdProvider, (_, _) {});
        repo.controller.add(everyone());
        await settle();
        expect(
          container
              .read(presenceStoreProvider)['u3']!
              .lastSeen!
              .millisecondsSinceEpoch,
          1003,
        );

        repo.controller.add(everyone(heartbeat: 135000));
        await settle();
        expect(
          container
              .read(presenceStoreProvider)['u3']!
              .lastSeen!
              .millisecondsSinceEpoch,
          1003,
          reason: 'inside the window: not yet published',
        );

        await Future<void>.delayed(const Duration(milliseconds: 120));
        expect(
          container
              .read(presenceStoreProvider)['u3']!
              .lastSeen!
              .millisecondsSinceEpoch,
          1003 + 135000,
          reason: 'published at the flush',
        );
      },
    );

    test(
      'the directory objects carry no presence, so nothing can read a stale one',
      () async {
        container.listen(usersByIdProvider, (_, _) {});
        repo.controller.add(everyone(heartbeat: 777));
        await settle();
        final u = container.read(usersByIdProvider)['u3']!;
        expect(u.lastSeen, isNull);
      },
    );

    test(
      'who is in the directory changing publishes presence immediately',
      () async {
        container.listen(usersByIdProvider, (_, _) {});
        repo.controller.add(everyone());
        await settle();
        repo.controller.add([
          ...everyone(heartbeat: 5000),
          user('newcomer', lastSeen: 42),
        ]);
        await settle();
        expect(
          container.read(usersByIdProvider).containsKey('newcomer'),
          isTrue,
        );
        expect(
          container
              .read(presenceStoreProvider)['newcomer']!
              .lastSeen!
              .millisecondsSinceEpoch,
          42,
          reason: 'a rebuild is happening anyway, so presence goes with it',
        );
      },
    );
  });
}
