import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/channel.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/groups_providers.dart';
import 'package:punx_messenger/utils/muted.dart';

UserProfile _me({
  List<String> mutedChats = const [],
  List<String> mutedGroups = const [],
  Map<String, Timestamp> lastRead = const {},
}) => UserProfile(
  id: 'me',
  email: 'me@x.test',
  name: 'Me',
  role: Role.employee,
  mutedChats: mutedChats,
  mutedGroups: mutedGroups,
  lastRead: lastRead,
);

void main() {
  group('muteLabel', () {
    test('says what pressing it will do', () {
      expect(muteLabel(false, 'channel'), 'Mute channel');
      expect(muteLabel(true, 'channel'), 'Unmute channel');
      expect(muteLabel(false, 'conversation'), 'Mute conversation');
      expect(muteLabel(true, 'conversation'), 'Unmute conversation');
    });
  });

  group('the profile reads mutedChats', () {
    UserProfile read(Object? raw) => UserProfile.fromMap('u1', {
      'name': 'U',
      'email': 'u@x.test',
      'mutedChats': raw,
    });

    test('a list of keys is kept in order', () {
      expect(read(['dms__a__b', 'groups__g__channels__c']).mutedChats, [
        'dms__a__b',
        'groups__g__channels__c',
      ]);
    });

    test('absent, or not a list, is none', () {
      expect(read(null).mutedChats, isEmpty);
      expect(read('dms__a__b').mutedChats, isEmpty);
      expect(read({'a': 1}).mutedChats, isEmpty);
      expect(UserProfile.fromMap('u1', {'name': 'U'}).mutedChats, isEmpty);
    });

    test('entries that are not text, or are empty, are dropped, not fatal', () {
      expect(read(['dms__a__b', 5, null, '', 'x', true, <String>[]]).mutedChats, [
        'dms__a__b',
        'x',
      ]);
    });
  });

  group('isChatMuted', () {
    test('is true only for a key the person muted', () {
      final p = _me(mutedChats: ['dms__a__b']);
      expect(isChatMuted(p, 'dms__a__b'), isTrue);
      expect(isChatMuted(p, 'dms__a__c'), isFalse);
      expect(isChatMuted(_me(), 'dms__a__b'), isFalse);
    });

    test('nobody signed in has muted nothing', () {
      expect(isChatMuted(null, 'dms__a__b'), isFalse);
    });

    test('a muted group is a different list, and is not a muted chat', () {
      expect(isChatMuted(_me(mutedGroups: ['dms__a__b']), 'dms__a__b'), isFalse);
    });
  });

  group('a muted channel does not light its group up', () {
    final now = Timestamp.fromDate(DateTime.now());
    const key1 = 'groups__g1__channels__c1';
    const key2 = 'groups__g1__channels__c2';

    Future<bool> hasUnread(UserProfile me, List<Channel> channels) async {
      final container = ProviderContainer(
        overrides: [
          profileProvider.overrideWith((ref) => Stream.value(me)),
          channelsProvider('g1').overrideWith((ref) => Stream.value(channels)),
        ],
      );
      addTearDown(container.dispose);
      await container.read(profileProvider.future);
      await container.read(channelsProvider('g1').future);
      return container.read(groupHasUnreadProvider('g1'));
    }

    final c1 = Channel(id: 'c1', name: 'one', lastMessageAt: now);
    final c2 = Channel(id: 'c2', name: 'two', lastMessageAt: now);

    test('an unread channel lights it up', () async {
      expect(await hasUnread(_me(), [c1]), isTrue);
    });

    test('muting that one channel puts the group out', () async {
      expect(await hasUnread(_me(mutedChats: [key1]), [c1]), isFalse);
    });

    test('another unread channel still lights it up', () async {
      expect(await hasUnread(_me(mutedChats: [key1]), [c1, c2]), isTrue);
    });

    test('muting a different conversation changes nothing here', () async {
      expect(await hasUnread(_me(mutedChats: [key2]), [c1]), isTrue);
    });

    test('a muted channel that is read, and an unread one that is muted, are both quiet', () async {
      final read = _me(lastRead: {key1: now});
      expect(await hasUnread(read, [c1]), isFalse);
      expect(await hasUnread(_me(mutedChats: [key1, key2]), [c1, c2]), isFalse);
    });

    test('a muted group is still quiet', () async {
      expect(await hasUnread(_me(mutedGroups: ['g1']), [c1]), isFalse);
    });
  });
}
