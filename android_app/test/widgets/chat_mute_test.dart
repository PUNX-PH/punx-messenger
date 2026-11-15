import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/channel.dart';
import 'package:punx_messenger/models/dm_convo.dart';
import 'package:punx_messenger/models/group.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/dm_providers.dart';
import 'package:punx_messenger/providers/groups_providers.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/providers/users_providers.dart';
import 'package:punx_messenger/screens/dms/dms_list_screen.dart';
import 'package:punx_messenger/screens/groups/channel_list_screen.dart';
import 'package:punx_messenger/services/groups_repository.dart';

/// Records what the screens ask for instead of touching Firestore.
class _FakeGroupsRepository implements GroupsRepository {
  final calls = <({String uid, String key, bool mute})>[];
  Object? failWith;

  @override
  Future<void> setChatMuted(String uid, String readKey, bool mute) async {
    if (failWith != null) throw failWith!;
    calls.add((uid: uid, key: readKey, mute: mute));
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _group = Group(
  id: 'g1',
  name: 'Team',
  ownerUid: 'owner',
  adminUids: ['owner'],
  memberUids: ['owner', 'member1'],
);

UserProfile _u(String id, Role role, {List<String> muted = const []}) =>
    UserProfile(
      id: id,
      email: '$id@punx.ai',
      name: id,
      role: role,
      mutedChats: muted,
    );

final _now = Timestamp.fromDate(DateTime.now());
const _chKey = 'groups__g1__channels__c1';

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<_FakeGroupsRepository> pumpChannels(
    WidgetTester tester, {
    required UserProfile me,
    List<Channel>? channels,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final repo = _FakeGroupsRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          groupsRepositoryProvider.overrideWithValue(repo),
          groupProvider('g1').overrideWith((ref) => Stream.value(_group)),
          profileProvider.overrideWith((ref) => Stream.value(me)),
          channelsProvider('g1').overrideWith(
            (ref) => Stream.value(
              channels ?? [Channel(id: 'c1', name: 'general', lastMessageAt: _now)],
            ),
          ),
          activeUsersProvider.overrideWithValue([me]),
        ],
        child: const MaterialApp(home: ChannelListScreen(groupId: 'g1')),
      ),
    );
    await tester.pumpAndSettle();
    return repo;
  }

  FontWeight? weightOf(WidgetTester tester, String text) =>
      tester.widget<Text>(find.text(text)).style?.fontWeight;

  final mutedIcon = find.byIcon(Icons.notifications_off_outlined);

  group('a channel in the list', () {
    testWidgets('unread and not muted: bold, no bell', (tester) async {
      await pumpChannels(tester, me: _u('member1', Role.employee));
      expect(weightOf(tester, 'general'), FontWeight.w700);
      expect(mutedIcon, findsNothing);
    });

    testWidgets('muted: not bold even though it has something new, and shows the bell', (tester) async {
      await pumpChannels(tester, me: _u('member1', Role.employee, muted: [_chKey]));
      expect(weightOf(tester, 'general'), FontWeight.w400);
      expect(mutedIcon, findsOneWidget);
    });

    testWidgets('muting another conversation changes nothing here', (tester) async {
      await pumpChannels(tester, me: _u('member1', Role.employee, muted: ['dms__a__b']));
      expect(weightOf(tester, 'general'), FontWeight.w700);
      expect(mutedIcon, findsNothing);
    });

    testWidgets('long-press offers Mute to a plain member, and nothing about access', (tester) async {
      await pumpChannels(tester, me: _u('member1', Role.employee));
      await tester.longPress(find.text('general'));
      await tester.pumpAndSettle();
      expect(find.text('Mute channel'), findsOneWidget);
      expect(find.text('Channel access'), findsNothing);
    });

    testWidgets('an admin also gets Channel access', (tester) async {
      await pumpChannels(tester, me: _u('owner', Role.employee));
      await tester.longPress(find.text('general'));
      await tester.pumpAndSettle();
      expect(find.text('Mute channel'), findsOneWidget);
      expect(find.text('Channel access'), findsOneWidget);
    });

    testWidgets('a muted one offers Unmute', (tester) async {
      await pumpChannels(tester, me: _u('member1', Role.employee, muted: [_chKey]));
      await tester.longPress(find.text('general'));
      await tester.pumpAndSettle();
      expect(find.text('Unmute channel'), findsOneWidget);
      expect(find.text('Mute channel'), findsNothing);
    });

    testWidgets('Mute asks for exactly that channel to be muted, and closes the menu', (tester) async {
      final repo = await pumpChannels(tester, me: _u('member1', Role.employee));
      await tester.longPress(find.text('general'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Mute channel'));
      await tester.pumpAndSettle();
      expect(repo.calls, [(uid: 'member1', key: _chKey, mute: true)]);
      expect(find.text('Mute channel'), findsNothing, reason: 'the menu closed');
    });

    testWidgets('Unmute asks for it to be unmuted', (tester) async {
      final repo = await pumpChannels(tester, me: _u('member1', Role.employee, muted: [_chKey]));
      await tester.longPress(find.text('general'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Unmute channel'));
      await tester.pumpAndSettle();
      expect(repo.calls, [(uid: 'member1', key: _chKey, mute: false)]);
    });

    testWidgets('when it fails it says so instead of staying silent', (tester) async {
      final repo = await pumpChannels(tester, me: _u('member1', Role.employee));
      repo.failWith = StateError('offline');
      await tester.longPress(find.text('general'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Mute channel'));
      await tester.pumpAndSettle();
      expect(find.text("Couldn't change that."), findsOneWidget);
    });

    testWidgets('Channel access still opens the access sheet for an admin', (tester) async {
      await pumpChannels(tester, me: _u('owner', Role.employee));
      await tester.longPress(find.text('general'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Channel access'));
      await tester.pumpAndSettle();
      expect(find.text('Mute channel'), findsNothing, reason: 'the menu closed');
      expect(find.byType(BottomSheet), findsOneWidget, reason: 'and the access sheet opened');
    });
  });

  group('a DM in the list', () {
    const dmKey = 'dms__me__zed';

    Future<_FakeGroupsRepository> pumpDms(
      WidgetTester tester, {
      List<String> muted = const [],
      bool hasConvo = true,
    }) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final repo = _FakeGroupsRepository();
      final me = _u('me', Role.employee, muted: muted);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            groupsRepositoryProvider.overrideWithValue(repo),
            profileProvider.overrideWith((ref) => Stream.value(me)),
            statusOfProvider.overrideWith((ref, uid) => 'online'),
            activeUsersProvider.overrideWithValue([me, _u('zed', Role.employee)]),
            myDmConvosProvider.overrideWith(
              (ref) => Stream.value(
                hasConvo
                    ? {
                        'zed': DmConvo(
                          id: 'me__zed',
                          members: const ['me', 'zed'],
                          lastMessageAt: _now,
                          lastMessageAuthorUid: 'zed',
                        ),
                      }
                    : <String, DmConvo>{},
              ),
            ),
          ],
          child: const MaterialApp(home: DmsListScreen()),
        ),
      );
      await tester.pumpAndSettle();
      return repo;
    }

    testWidgets('unread and not muted: bold, no bell', (tester) async {
      await pumpDms(tester);
      expect(weightOf(tester, 'zed'), FontWeight.w700);
      expect(mutedIcon, findsNothing);
    });

    testWidgets('muted: not bold, and shows the bell', (tester) async {
      await pumpDms(tester, muted: [dmKey]);
      expect(weightOf(tester, 'zed'), FontWeight.w400);
      expect(mutedIcon, findsOneWidget);
    });

    testWidgets('long-press offers Mute conversation, and asks for exactly that DM', (tester) async {
      final repo = await pumpDms(tester);
      await tester.longPress(find.text('zed'));
      await tester.pumpAndSettle();
      expect(find.text('Mute conversation'), findsOneWidget);
      await tester.tap(find.text('Mute conversation'));
      await tester.pumpAndSettle();
      expect(repo.calls, [(uid: 'me', key: dmKey, mute: true)]);
    });

    testWidgets('a muted one offers Unmute conversation', (tester) async {
      await pumpDms(tester, muted: [dmKey]);
      await tester.longPress(find.text('zed'));
      await tester.pumpAndSettle();
      expect(find.text('Unmute conversation'), findsOneWidget);
    });

    testWidgets('with nobody written to yet there is nothing to mute', (tester) async {
      await pumpDms(tester, hasConvo: false);
      // (Pressing and holding a row that has no menu would just open it, which needs
      // the app's router; so this looks at the row itself.)
      final row = tester.widget<ListTile>(find.widgetWithText(ListTile, 'zed'));
      expect(row.onLongPress, isNull);
    });

    testWidgets('and one that has a conversation has a menu', (tester) async {
      await pumpDms(tester);
      expect(
        tester.widget<ListTile>(find.widgetWithText(ListTile, 'zed')).onLongPress,
        isNotNull,
      );
    });
  });

  test("the write is the web's: the same field on the person's own document, union to mute, remove to unmute", () {
    // (There is no Firestore here to run it against, so this pins it. Web: db.js
    // setChatMuted: updateDoc(users/uid, { mutedChats: mute ? arrayUnion(key) : arrayRemove(key) }).)
    final src = File('lib/services/groups_repository.dart')
        .readAsStringSync()
        .replaceAll('\r\n', '\n');
    expect(
      src.contains(
        "  Future<void> setChatMuted(String uid, String readKey, bool mute) async {\n"
        "    await _db.collection('users').doc(uid).update({\n"
        "      'mutedChats': mute\n"
        "          ? FieldValue.arrayUnion([readKey])\n"
        "          : FieldValue.arrayRemove([readKey]),\n"
        "    });\n"
        "  }",
      ),
      isTrue,
    );
  });

  test('a voice channel has nothing to mute: an admin goes straight to access, anyone else has no menu (a pin: the real voice controller cannot be built in a widget test)', () {
    final src = File('lib/screens/groups/channel_list_screen.dart')
        .readAsStringSync()
        .replaceAll('\r\n', '\n');
    expect(src.contains('onLongPress: isVoice && !elevated\n          ? null'), isTrue);
    expect(
      src.contains('if (isVoice) {\n                access();\n                return;\n              }\n'),
      isTrue,
    );
    expect(
      src.indexOf('if (isVoice) {\n                access();'),
      lessThan(src.indexOf('showChatMenuSheet(')),
      reason: 'a voice channel is dealt with before the menu that has Mute in it',
    );
  });

  test('a muted DM neither pings nor notifies (the listener cannot run here, so this pins it)', () {
    final src = File('lib/services/notification_listener_service.dart')
        .readAsStringSync()
        .replaceAll('\r\n', '\n');
    final guard = src.indexOf("pathToReadKey('dms/\${doc.id}')");
    final ping = src.indexOf('_pingIfNew(doc.id');
    final fire = src.indexOf("key: 'dm:\${doc.id}'");
    expect(guard, greaterThan(0));
    expect(guard, lessThan(ping), reason: 'the mute check comes before the in-app ping');
    expect(ping, lessThan(fire));
    expect(
      src.contains(
        "    if (isChatMuted(\n      _ref.read(profileProvider).valueOrNull,\n      pathToReadKey('dms/\${doc.id}'),\n    )) {\n      return;\n    }",
      ),
      isTrue,
    );
  });
}
