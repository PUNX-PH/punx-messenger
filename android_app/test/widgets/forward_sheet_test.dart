import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/channel.dart';
import 'package:punx_messenger/models/dm_convo.dart';
import 'package:punx_messenger/models/group.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/dm_providers.dart';
import 'package:punx_messenger/providers/groups_providers.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/providers/users_providers.dart';
import 'package:punx_messenger/utils/forward_targets.dart';
import 'package:punx_messenger/widgets/chat/forward_sheet.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';
import 'package:punx_messenger/widgets/shared/avatar.dart';

UserProfile _u(String id, String name, {String? email}) =>
    UserProfile(id: id, email: email ?? '$id@x.test', name: name, role: Role.employee);

final _me = _u('me', 'Me');
const _group = Group(id: 'g1', name: 'Team', ownerUid: 'me', adminUids: ['me'], memberUids: ['me']);

ChatMessage _msg({String text = 'see you at 3', Object? audioURL}) => ChatMessage.fromMap('m1', {
  'text': text,
  'audioURL': audioURL,
  'author': {'uid': 'ana', 'name': 'Ana'},
});

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  /// Opens the sheet from a button, so that closing it and the note it leaves can be seen.
  Future<List<ForwardTarget>> pumpSheet(
    WidgetTester tester, {
    required Future<bool> Function(ForwardTarget) send,
    ChatMessage? message,
    String currentPath = 'groups/g1/channels/general/messages',
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final asked = <ForwardTarget>[];
    final ana = _u('ana', 'Ana Reyes');
    final zed = _u('zed', 'Zed Cruz');
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          profileProvider.overrideWith((ref) => Stream.value(_me)),
          activeUsersProvider.overrideWithValue([_me, ana, zed]),
          usersByIdProvider.overrideWithValue({'me': _me, 'ana': ana, 'zed': zed}),
          myDmConvosProvider.overrideWith(
            (ref) => Stream.value({
              'zed': DmConvo(id: 'me__zed', members: const ['me', 'zed'], lastMessageAt: Timestamp.fromMillisecondsSinceEpoch(9000)),
            }),
          ),
          myGroupsProvider.overrideWith((ref) => Stream.value(const [_group])),
          channelsProvider('g1').overrideWith(
            (ref) => Stream.value(const [
              Channel(id: 'general', name: 'general'),
              Channel(id: 'random', name: 'random'),
              Channel(id: 'lounge', name: 'lounge', type: 'voice'),
            ]),
          ),
        ],
        child: MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => showForwardSheet(
                    context,
                    message: message ?? _msg(),
                    currentPath: currentPath,
                    send: (t) {
                      asked.add(t);
                      return send(t);
                    },
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return asked;
  }

  group('the Forward box', () {
    testWidgets('shows what is being forwarded, and who wrote it', (tester) async {
      await pumpSheet(tester, send: (_) async => true);
      expect(find.text('Forward message'), findsOneWidget);
      expect(find.text('see you at 3'), findsOneWidget);
      // Ana Reyes is in the list too; the name the message itself carries (Ana) must not be what is shown.
      expect(find.text('Ana'), findsNothing, reason: 'the directory name is used, not the one stored on the message');
      expect(find.text('Ana Reyes'), findsNWidgets(2), reason: 'above the preview, and as a person in the list');
    });

    testWidgets('a voice message is previewed as one', (tester) async {
      await pumpSheet(tester, send: (_) async => true, message: _msg(text: '', audioURL: 'data:audio/mp4;base64,AAAA'));
      expect(find.text('[voice message]'), findsOneWidget);
    });

    testWidgets('offers your notes, people and text channels, but not a voice room or where it already is', (tester) async {
      await pumpSheet(tester, send: (_) async => true);
      expect(find.text('My Notes'), findsOneWidget);
      expect(find.text('Zed Cruz'), findsOneWidget);
      expect(find.text('random'), findsOneWidget);
      expect(find.text('lounge'), findsNothing, reason: 'a voice room');
      expect(find.text('general'), findsNothing, reason: 'the conversation it is in');
      expect(find.text('me'), findsNothing, reason: 'yourself');
      expect(find.byType(Avatar), findsNWidgets(2), reason: 'a face for each person');
      expect(find.text('#'), findsOneWidget, reason: 'a hash for the channel');
      expect(find.text('\u270E'), findsOneWidget, reason: 'a pencil for the notes');
    });

    testWidgets('says where a channel is, and a person\'s email', (tester) async {
      await pumpSheet(tester, send: (_) async => true);
      expect(find.text('in Team'), findsOneWidget);
      expect(find.text('zed@x.test'), findsOneWidget);
      expect(find.text('Private to you'), findsOneWidget);
    });

    testWidgets('what you type narrows it, and # and @ narrow it by kind', (tester) async {
      await pumpSheet(tester, send: (_) async => true);
      await tester.enterText(find.byType(TextField), 'zed');
      await tester.pump();
      expect(find.text('Zed Cruz'), findsOneWidget);
      expect(find.text('random'), findsNothing);
      await tester.enterText(find.byType(TextField), '#');
      await tester.pump();
      expect(find.text('random'), findsOneWidget);
      expect(find.text('Zed Cruz'), findsNothing);
      await tester.enterText(find.byType(TextField), '@');
      await tester.pump();
      expect(find.text('Zed Cruz'), findsOneWidget);
      expect(find.text('random'), findsNothing);
    });

    testWidgets('with no match it says so', (tester) async {
      await pumpSheet(tester, send: (_) async => true);
      await tester.enterText(find.byType(TextField), 'qqq');
      await tester.pump();
      expect(find.text('Nothing matches "qqq".'), findsOneWidget);
    });

    testWidgets('tapping one forwards to exactly that, closes the box and says where', (tester) async {
      final asked = await pumpSheet(tester, send: (_) async => true);
      await tester.tap(find.text('random'));
      await tester.pumpAndSettle();
      expect(asked.map((t) => t.id), ['ch:g1:random']);
      expect(find.text('Forward message'), findsNothing, reason: 'the box closed');
      expect(find.text('Forwarded to #random'), findsOneWidget);
    });

    testWidgets('a person is named, and your notes are "your notes"', (tester) async {
      await pumpSheet(tester, send: (_) async => true);
      await tester.tap(find.text('Zed Cruz'));
      await tester.pumpAndSettle();
      expect(find.text('Forwarded to Zed Cruz'), findsOneWidget);
    });

    testWidgets('notes: the note says your notes', (tester) async {
      await pumpSheet(tester, send: (_) async => true);
      await tester.tap(find.text('My Notes'));
      await tester.pumpAndSettle();
      expect(find.text('Forwarded to your notes'), findsOneWidget);
    });

    testWidgets('while it is going nothing else can be chosen, and a second tap sends nothing more', (tester) async {
      final hold = Completer<bool>();
      final asked = await pumpSheet(tester, send: (_) => hold.future);
      await tester.tap(find.text('random'));
      await tester.pump();
      expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);
      expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Cancel')).onPressed, isNull);
      await tester.tap(find.text('Zed Cruz'), warnIfMissed: false);
      await tester.pump();
      expect(asked, hasLength(1));
      hold.complete(true);
      await tester.pumpAndSettle();
      expect(find.text('Forwarded to #random'), findsOneWidget);
      expect(asked, hasLength(1));
    });

    testWidgets('when it fails it says so, stays open, and lets you try again', (tester) async {
      var ok = false;
      final asked = await pumpSheet(tester, send: (_) async => ok);
      await tester.tap(find.text('random'));
      await tester.pumpAndSettle();
      expect(find.text("Couldn't forward it. Check your connection and try again."), findsOneWidget);
      expect(find.text('Forward message'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).enabled, isTrue);
      ok = true;
      await tester.tap(find.text('random'));
      await tester.pumpAndSettle();
      expect(asked, hasLength(2));
      expect(find.text('Forwarded to #random'), findsOneWidget);
    });

    testWidgets('a send that throws counts as a failure', (tester) async {
      await pumpSheet(tester, send: (_) async => throw StateError('boom'));
      await tester.tap(find.text('random'));
      await tester.pumpAndSettle();
      expect(find.text("Couldn't forward it. Check your connection and try again."), findsOneWidget);
    });

    testWidgets('Cancel closes it and forwards nothing', (tester) async {
      final asked = await pumpSheet(tester, send: (_) async => true);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Forward message'), findsNothing);
      expect(asked, isEmpty);
      expect(find.textContaining('Forwarded to'), findsNothing);
    });
  });

  group('the menu entry', () {
    Future<void> pumpRow(WidgetTester tester, ChatMessage message, {ValueChanged<ChatMessage>? onForward}) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
          child: MaterialApp(
            home: Scaffold(
              body: MessageRow(
                message: message,
                showHeader: true,
                meUid: 'me',
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
                onReply: (_) {},
                onForward: onForward,
              ),
            ),
          ),
        ),
      );
      await tester.longPress(find.text('Ana'));
      await tester.pumpAndSettle();
    }

    testWidgets('Forward is offered for a message that has something to pass on', (tester) async {
      await pumpRow(tester, _msg(), onForward: (_) {});
      expect(find.text('Forward'), findsOneWidget);
    });

    testWidgets('it is offered for a voice message too', (tester) async {
      await pumpRow(tester, _msg(text: '', audioURL: 'data:audio/mp4;base64,AAAA'), onForward: (_) {});
      expect(find.text('Forward'), findsOneWidget);
    });

    testWidgets('not where forwarding is not offered', (tester) async {
      await pumpRow(tester, _msg());
      expect(find.text('Reply'), findsOneWidget, reason: 'the menu did open');
      expect(find.text('Forward'), findsNothing);
    });

    testWidgets('not for a message with nothing to pass on', (tester) async {
      await pumpRow(tester, _msg(text: ''), onForward: (_) {});
      expect(find.text('Reply'), findsOneWidget);
      expect(find.text('Forward'), findsNothing);
    });

    testWidgets('tapping it closes the menu and hands over exactly this message', (tester) async {
      final got = <ChatMessage>[];
      await pumpRow(tester, _msg(), onForward: got.add);
      await tester.tap(find.text('Forward'));
      await tester.pumpAndSettle();
      expect(got.map((m) => m.id), ['m1']);
      expect(find.text('Reply'), findsNothing, reason: 'the menu closed');
    });
  });

  group('the pieces, pinned (the chat screen and the Firestore writes cannot run in a widget test)', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the screen opens the box for the message, from this conversation, sending through the controller', () {
      expect(
        read('lib/widgets/chat/chat_surface.dart').contains(
          '                  onForward: (m) => showForwardSheet(\n'
          '                    context,\n'
          '                    message: m,\n'
          '                    currentPath: widget.path,\n'
          '                    send: (target) => controller.forwardMessage(m, target),\n'
          '                  ),',
        ),
        isTrue,
      );
    });

    test('the list passes it on to each row', () {
      expect(read('lib/widgets/chat/message_list.dart').contains('onForward: widget.onForward,'), isTrue);
    });

    test('the controller makes the conversation for a person first, then sends the copy marked with who wrote it', () {
      final s = read('lib/providers/messages_providers.dart');
      expect(
        s.contains(
          '  Future<bool> forwardMessage(ChatMessage message, ForwardTarget target) async {\n'
          '    final me = _ref.read(profileProvider).valueOrNull;\n'
          '    final payload = forwardPayload(message, _ref.read(usersByIdProvider));\n'
          '    if (me == null || payload == null) return false;\n'
          '    try {\n'
          '      // A person you have not messaged yet has no conversation to put it in.\n'
          '      final other = target.user;\n'
          '      if (target.kind == TargetKind.dm && other != null) {\n'
          '        await _ref.read(dmRepositoryProvider).ensureDmConvo(me, other);\n'
          '      }\n'
          '      await _repo.sendMessage(\n'
          '        target.path,\n'
          '        text: payload.text,\n'
          '        author: me,\n'
          '        remoteImageUrl: payload.imageURL,\n'
          '        remoteImageMeta: payload.imageMeta?.toMap(),\n'
          '        voice: payload.voice,\n'
          '        forwardedFrom: payload.forwardedFrom,\n'
          '      );\n'
          '      return true;\n'
          '    } catch (_) {\n'
          '      return false;\n'
          '    }\n'
          '  }',
        ),
        isTrue,
      );
    });

    test('a message can now carry a voice message and who wrote it first, and a DM\'s last line says it was a voice message', () {
      final s = read('lib/services/messages_repository.dart');
      expect(s.contains('    VoiceClip? voice,\n    ForwardedFrom? forwardedFrom,\n  }) async {'), isTrue);
      expect(
        s.contains(
          "      'audioURL': voice?.dataUrl,\n"
          "      'audioMeta': voice == null\n"
          "          ? null\n"
          "          : {'durationMs': voice.durationMs, 'mime': voice.storedMime},\n"
          "      'forwardedFrom': forwardedFrom?.toMap(),\n",
        ),
        isTrue,
      );
      expect(s.contains("(voice != null ? '\u{1F3A4} Voice message' : '\u{1F4F7} Image'),"), isTrue);
      expect(s.contains('        remoteImageUrl == null &&\n        voice == null) {\n      return;\n    }'), isTrue);
    });
  });
}
