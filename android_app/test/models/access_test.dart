import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/channel.dart';
import 'package:punx_messenger/models/channel_viewer.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/users_providers.dart';

/// The access model shared with the web app and enforced by firestore.rules.
///
/// Everything here is a pure function of a document's fields, and every one of
/// them fails SILENTLY when it's wrong: a `deactivated` key that doesn't parse
/// leaves a removed employee in everyone's DM list and mention picker, and the
/// wrong directory shape leaves them mentionable. Nothing throws, so
/// `flutter analyze` cannot catch any of it.
///
/// The absent-key cases carry the most weight: the rules treat a missing
/// `deactivated` as active, and both clients have to agree with that.
void main() {
  UserProfile profile(String id, Map<String, dynamic> data) =>
      UserProfile.fromMap(id, {'email': '$id@punx.ai', 'name': id, ...data});

  group('UserProfile.deactivated', () {
    test('absent key reads as active', () {
      expect(profile('u1', {}).deactivated, isFalse);
    });

    test('true means removed, false means active', () {
      expect(profile('u1', {'deactivated': true}).deactivated, isTrue);
      expect(profile('u1', {'deactivated': false}).deactivated, isFalse);
    });

    test('a stray non-bool value fails safe, as active', () {
      // Reactivating clears the field with deleteField(), so this shouldn't
      // arise — but reading a stray value as "removed" would lock someone out
      // of their own workspace, which is the worse direction to be wrong in.
      expect(profile('u1', {'deactivated': 'yes'}).deactivated, isFalse);
      expect(profile('u1', {'deactivated': null}).deactivated, isFalse);
    });
  });

  group('Role parsing', () {
    test('every role the rules know round-trips', () {
      for (final r in Role.values) {
        expect(Role.fromString(r.toFirestore()), r, reason: r.name);
      }
    });

    test('guest and developer no longer fall back to employee', () {
      // They did until 2026-08-27, which is why a guest was shown a
      // create-group button the rules refuse, and a developer was badged
      // "Employee".
      expect(Role.fromString('guest'), Role.guest);
      expect(Role.fromString('developer'), Role.developer);
    });

    test('an unrecognised role still falls back to employee', () {
      expect(Role.fromString('wizard'), Role.employee);
      expect(Role.fromString(null), Role.employee);
    });

    test('developer holds both admin tiers; guest holds neither', () {
      expect(Role.developer.isAdmin, isTrue);
      expect(Role.developer.isSuperAdmin, isTrue);
      expect(Role.guest.isAdmin, isFalse);
      expect(Role.guest.isGuest, isTrue);
      expect(Role.employee.isGuest, isFalse);
    });
  });

  group('Channel privacy fields', () {
    Channel channel(Map<String, dynamic> data) => Channel.fromMap('c1', {
      'name': 'general',
      'type': 'text',
      ...data,
    });

    test('absent keys read as public with nobody listed', () {
      // Every writer stamps both now, and the backfill stamped the rest — but
      // the rules DENY a channel missing `private`, so if one ever reaches the
      // client it must not be labelled as public-and-fine.
      expect(channel({}).private, isFalse);
      expect(channel({}).allowUids, isEmpty);
    });

    test('private and allowUids parse', () {
      final c = channel({'private': true, 'allowUids': ['a', 'b']});
      expect(c.private, isTrue);
      expect(c.allowUids, ['a', 'b']);
    });
  });

  group('ChannelViewer', () {
    test('anonymous asks for public channels only', () {
      expect(ChannelViewer.anonymous.uid, isNull);
      expect(ChannelViewer.anonymous.guest, isFalse);
      expect(ChannelViewer.anonymous.seesPrivate, isFalse);
    });

    test('a guest does not also ask for the private leg', () {
      // The array-contains leg is the only query the rules will serve a guest.
      // Setting both would contradict, and the private leg would be denied.
      const v = ChannelViewer(uid: 'g1', guest: true);
      expect(v.guest, isTrue);
      expect(v.seesPrivate, isFalse);
    });
  });

  group('the directory shapes', () {
    late ProviderContainer container;

    final directory = [
      profile('active', {}),
      profile('removed', {'deactivated': true}),
      profile('bot', {'type': 'bot', 'deactivated': true}),
      profile('livebot', {'type': 'bot'}),
    ];

    setUp(() async {
      container = ProviderContainer(
        overrides: [
          usersStreamProvider.overrideWith((ref) => Stream.value(directory)),
        ],
      );
      addTearDown(container.dispose);
      await container.read(usersStreamProvider.future);
    });

    test('activeUsers drops removed people AND retired bots', () {
      // The retired bot needs no bot-specific code: setBotEnabled on the web
      // mirrors the registry's `enabled` flag onto the same field.
      expect(
        container.read(activeUsersProvider).map((u) => u.id),
        ['active', 'livebot'],
      );
    });

    test('byId keeps everyone, so old messages keep their authors', () {
      final byId = container.read(usersByIdProvider);
      expect(byId.keys, containsAll(['active', 'removed', 'bot', 'livebot']));
      expect(byId['removed']!.name, 'removed');
    });
  });
}
