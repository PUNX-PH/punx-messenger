import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/providers/users_providers.dart';
import 'package:punx_messenger/services/users_repository.dart';
import 'package:punx_messenger/widgets/chat/message_list.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';
import 'package:punx_messenger/widgets/shared/seen_switch.dart';

class _FakeUsersRepository implements UsersRepository {
  final calls = <({String uid, bool on})>[];
  Object? failWith;
  Completer<void>? hold;

  @override
  Future<void> setShareSeen(String uid, bool on) async {
    if (hold != null) await hold!.future;
    if (failWith != null) throw failWith!;
    calls.add((uid: uid, on: on));
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

UserProfile _me({bool shareSeen = true}) => UserProfile(
  id: 'me',
  email: 'me@x.test',
  name: 'Me',
  role: Role.employee,
  shareSeen: shareSeen,
);

ChatMessage _msg(String id, String uid, DateTime at) => ChatMessage(
  id: id,
  author: MessageAuthor(uid: uid, name: uid),
  text: 'message $id',
  createdAt: Timestamp.fromDate(at),
);

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  group('the switch in the profile sheet', () {
    Future<_FakeUsersRepository> pumpSwitch(WidgetTester tester, {UserProfile? me}) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final repo = _FakeUsersRepository();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            usersRepositoryProvider.overrideWithValue(repo),
            profileProvider.overrideWith((ref) => Stream.value(me ?? _me())),
          ],
          child: const MaterialApp(home: Scaffold(body: SingleChildScrollView(child: SeenSwitch()))),
        ),
      );
      await tester.pumpAndSettle();
      return repo;
    }

    bool isOn(WidgetTester tester) => tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value;

    testWidgets('says what it does, and is on by default', (tester) async {
      await pumpSwitch(tester);
      expect(find.text("Let others see when I've read their messages"), findsOneWidget);
      expect(find.textContaining('you do not see theirs'), findsOneWidget);
      expect(isOn(tester), isTrue);
    });

    testWidgets('shows it off when it was switched off (here or on the web)', (tester) async {
      await pumpSwitch(tester, me: _me(shareSeen: false));
      expect(isOn(tester), isFalse);
    });

    testWidgets('switching it off writes false for you', (tester) async {
      final repo = await pumpSwitch(tester);
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      expect(repo.calls, [(uid: 'me', on: false)]);
    });

    testWidgets('switching it on writes true', (tester) async {
      final repo = await pumpSwitch(tester, me: _me(shareSeen: false));
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      expect(repo.calls, [(uid: 'me', on: true)]);
    });

    testWidgets('a failed write is said, and nothing else happens', (tester) async {
      final repo = await pumpSwitch(tester);
      repo.failWith = Exception('offline');
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      expect(find.text("Couldn't save that. Try again."), findsOneWidget);
      expect(repo.calls, isEmpty);
    });

    testWidgets('with nobody signed in yet, it does nothing', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final repo = _FakeUsersRepository();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            usersRepositoryProvider.overrideWithValue(repo),
            profileProvider.overrideWith((ref) => Stream<UserProfile?>.value(null)),
          ],
          child: const MaterialApp(home: Scaffold(body: SeenSwitch())),
        ),
      );
      await tester.pumpAndSettle();
      expect(isOn(tester), isTrue, reason: 'the default');
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      expect(repo.calls, isEmpty);
    });
  });

  group('the line under a message', () {
    Future<void> pumpList(WidgetTester tester, {String? seenId, String seenText = ''}) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final now = DateTime.now();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
          child: MaterialApp(
            home: Scaffold(
              body: MessageListView(
                messages: [
                  _msg('m1', 'me', now.subtract(const Duration(minutes: 30))),
                  _msg('m2', 'them', now.subtract(const Duration(minutes: 20))),
                  _msg('m3', 'me', now.subtract(const Duration(minutes: 10))),
                  _msg('m4', 'me', now.subtract(const Duration(minutes: 1))),
                ],
                meUid: 'me',
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
                emptyTitle: 'Nothing here',
                emptyDesc: 'Say something',
                seenId: seenId,
                seenText: seenText,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('appears once, right under the message it is for, and not under any other', (tester) async {
      await pumpList(tester, seenId: 'm3', seenText: 'Seen 3:41 PM');
      expect(find.text('Seen 3:41 PM'), findsOneWidget);
      Finder rowOf(String text) => find.ancestor(of: find.text(text, findRichText: true), matching: find.byType(MessageRow));
      expect(find.descendant(of: rowOf('message m3'), matching: find.text('Seen 3:41 PM')), findsOneWidget);
      for (final other in ['message m1', 'message m2', 'message m4']) {
        final r = rowOf(other);
        expect(r, findsOneWidget, reason: 'the row for $other is on screen, so "nothing under it" means something');
        expect(find.descendant(of: r, matching: find.text('Seen 3:41 PM')), findsNothing, reason: other);
      }
    });

    testWidgets('is right-aligned', (tester) async {
      await pumpList(tester, seenId: 'm4', seenText: 'Seen 3:41 PM');
      final align = tester.widget<Align>(find.ancestor(of: find.text('Seen 3:41 PM'), matching: find.byType(Align)).first);
      expect(align.alignment, Alignment.centerRight);
    });

    testWidgets('nothing without an id or without text', (tester) async {
      await pumpList(tester);
      expect(find.textContaining('Seen'), findsNothing);
      await pumpList(tester, seenId: 'm3');
      expect(find.textContaining('Seen'), findsNothing, reason: 'an id with no words');
      await pumpList(tester, seenText: 'Seen 3:41 PM');
      expect(find.textContaining('Seen'), findsNothing, reason: 'words with no message');
    });

    testWidgets('an id that is not in the list shows nothing', (tester) async {
      await pumpList(tester, seenId: 'gone', seenText: 'Seen 3:41 PM');
      expect(find.text('Seen 3:41 PM'), findsNothing);
    });
  });

  group('pins (the chat screen, the controller and Firestore cannot run in a widget test)', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the repository writes the receipt in the same update as lastRead, only for a DM, only when asked', () {
      final s = read('lib/services/messages_repository.dart');
      expect(
        s.contains(
          "  Future<void> markRead(String uid, String containerPath, {bool seen = false}) async {\n"
          "    if (uid.isEmpty || containerPath.isEmpty) return;\n"
          "    final key = pathToReadKey(containerPath);\n"
          "    await _db.collection('users').doc(uid).update({\n"
          "      'lastRead.\$key': FieldValue.serverTimestamp(),\n"
          "      if (seen && isDmPath(containerPath)) 'seen.\$key': FieldValue.serverTimestamp(),\n"
          "    });",
        ),
        isTrue,
      );
    });

    test('marking as read from a list never writes a receipt', () {
      final g = read('lib/services/groups_repository.dart');
      expect(g.contains("'seen"), isFalse);
      expect(g.contains('seen.'), isFalse);
    });

    test('the controller asks shouldRecordSeen with your own receipt, your choice and the app being in front', () {
      final s = read('lib/providers/messages_providers.dart');
      expect(
        s.contains(
          '  Future<void> markRead({Timestamp? newest, bool visible = true}) async {\n'
          '    final me = _ref.read(profileProvider).valueOrNull;\n'
          '    final uid = me?.id;\n'
          "    if (uid == null || path.startsWith('users/')) return;\n"
          '    final seen = shouldRecordSeen(\n'
          '      containerPath: containerPath,\n'
          '      newestCreatedAt: newest,\n'
          '      seen: me!.seen[pathToReadKey(containerPath)],\n'
          '      share: me.shareSeen,\n'
          '      visible: visible,\n'
          '    );\n'
          '    await _repo.markRead(uid, containerPath, seen: seen);',
        ),
        isTrue,
      );
    });

    test('the chat tells the controller the newest message and whether the app is in front, and records again when you come back', () {
      final s = read('lib/widgets/chat/chat_surface.dart');
      expect(s.contains('with WidgetsBindingObserver'), isTrue);
      expect(s.contains('WidgetsBinding.instance.addObserver(this);'), isTrue);
      expect(s.contains('WidgetsBinding.instance.removeObserver(this);'), isTrue);
      expect(
        s.contains(
          '    final s = WidgetsBinding.instance.lifecycleState;\n'
          '    return s == null || s == AppLifecycleState.resumed;',
        ),
        isTrue,
      );
      expect(
        s.contains(
          '            newest: messages == null || messages.isEmpty ? null : messages.last.createdAt,\n'
          '            visible: _inFront,',
        ),
        isTrue,
      );
      expect(
        s.contains(
          '    if (state == AppLifecycleState.resumed &&\n'
          '        ref.read(messagesProvider(widget.path)).valueOrNull != null) {\n'
          '      _scheduleMarkRead();',
        ),
        isTrue,
        reason: 'only once the messages are in',
      );
    });

    test('the chat watches the other person only in a DM you share, and shows nothing when you do not', () {
      final s = read('lib/widgets/chat/chat_surface.dart');
      expect(
        s.contains(
          '    final watchPeer = shareSeen && widget.seenBy != null && containerPath != null && isDmPath(containerPath);',
        ),
        isTrue,
      );
      expect(s.contains('final seen = watchPeer ? seenMarker(messages, meUid, peerSeenAt) : null;'), isTrue);
      expect(s.contains('                  seenId: seen?.id,\n                  seenText: seenText,'), isTrue);
      expect(
        s.contains('              otherUid: widget.seenBy!,\n              key: pathToReadKey(containerPath),'),
        isTrue,
        reason: 'that DM\'s receipt on the other person\'s profile',
      );
    });

    test('the chat reads your choice with sharing ON as the default, and writes the time in the phone clock', () {
      final s = read('lib/widgets/chat/chat_surface.dart');
      expect(s.contains('      profileProvider.select((p) => p.valueOrNull?.shareSeen ?? true),'), isTrue);
      expect(s.contains('            (t) => (use24h ? DateFormat.Hm() : DateFormat.jm()).format(t),'), isTrue);
      expect(s.contains('    final use24h = MediaQuery.alwaysUse24HourFormatOf(context);'), isTrue);
    });

    test('only the DM screen is given someone to watch', () {
      expect(read('lib/screens/dms/dm_chat_screen.dart').contains('seenBy: otherUid,'), isTrue);
      final others = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart') && !f.path.endsWith('dm_chat_screen.dart') && !f.path.endsWith('chat_surface.dart'))
          .where((f) => f.readAsStringSync().contains('seenBy:'))
          .map((f) => f.path)
          .toList();
      expect(others, isEmpty);
    });

    test('the other person\'s receipt and your switch are written the way the web writes them', () {
      final s = read('lib/services/users_repository.dart');
      expect(
        s.contains(
          '  Stream<int?> listenPeerSeen(String otherUid, String key) => _db\n'
          "      .collection('users')\n"
          '      .doc(otherUid)\n'
          '      .snapshots()\n'
          '      .map((snap) => seenAtFromProfile(snap.data(), key))\n'
          '      .handleError((_) {});',
        ),
        isTrue,
      );
      expect(
        s.contains(
          '  Future<void> setShareSeen(String uid, bool on) async {\n'
          "    await _db.collection('users').doc(uid).update({\n"
          "      'prefs.shareSeen': on,\n"
          "      'prefs.updatedAt': DateTime.now().millisecondsSinceEpoch,\n"
          "      if (!on) 'seen': FieldValue.delete(),\n"
          '    });',
        ),
        isTrue,
        reason: 'the choice and updatedAt (how the web tells a newer copy), and off removes the receipts in the same write',
      );
    });

    test('the profile sheet has the switch', () {
      expect(read('lib/widgets/shared/profile_sheet.dart').contains('          const SeenSwitch(),\n'), isTrue);
    });
  });
}
