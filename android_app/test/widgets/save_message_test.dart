import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/utils/saved.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';

ChatMessage _msg({
  String text = '',
  String? imageURL,
  Object? audioURL,
  Object? forwardedFrom,
  Object? savedFrom,
}) => ChatMessage.fromMap('m1', {
  'text': text,
  'imageURL': imageURL,
  'audioURL': audioURL,
  'forwardedFrom': forwardedFrom,
  'savedFrom': savedFrom,
  'author': {'uid': 'ana', 'name': 'Ana'},
});

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<void> pumpRow(
    WidgetTester tester,
    ChatMessage message, {
    Future<SaveResult> Function(ChatMessage)? onSave,
  }) async {
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
              onSave: onSave,
            ),
          ),
        ),
      ),
    );
  }

  Future<void> openMenu(WidgetTester tester) async {
    await tester.longPress(find.text('Ana'));
    await tester.pumpAndSettle();
  }

  final saveItem = find.text('Save to My Notes');

  group('the menu entry', () {
    testWidgets('is offered for a message with text', (tester) async {
      await pumpRow(tester, _msg(text: 'hi'), onSave: (_) async => SaveResult.saved);
      await openMenu(tester);
      expect(saveItem, findsOneWidget);
    });

    testWidgets('is offered for a picture and for a voice message', (tester) async {
      await pumpRow(tester, _msg(imageURL: 'data:image/png;base64,AA'), onSave: (_) async => SaveResult.saved);
      await openMenu(tester);
      expect(saveItem, findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await pumpRow(tester, _msg(audioURL: 'data:audio/mp4;base64,AAAA'), onSave: (_) async => SaveResult.saved);
      await openMenu(tester);
      expect(saveItem, findsOneWidget);
    });

    testWidgets('is not offered where saving is not (inside My Notes)', (tester) async {
      await pumpRow(tester, _msg(text: 'hi'));
      await openMenu(tester);
      expect(find.text('Reply'), findsOneWidget, reason: 'the menu did open');
      expect(saveItem, findsNothing);
    });

    testWidgets('is not offered for a message with nothing to keep', (tester) async {
      await pumpRow(tester, _msg(), onSave: (_) async => SaveResult.saved);
      await openMenu(tester);
      expect(find.text('Reply'), findsOneWidget);
      expect(saveItem, findsNothing);
    });
  });

  group('saving', () {
    Future<List<ChatMessage>> run(WidgetTester tester, SaveResult result) async {
      final asked = <ChatMessage>[];
      await pumpRow(tester, _msg(text: 'hi'), onSave: (m) async {
        asked.add(m);
        return result;
      });
      await openMenu(tester);
      await tester.tap(saveItem);
      await tester.pumpAndSettle();
      return asked;
    }

    testWidgets('asks for exactly this message to be saved, and closes the menu', (tester) async {
      final asked = await run(tester, SaveResult.saved);
      expect(asked.map((m) => m.id), ['m1']);
      expect(saveItem, findsNothing, reason: 'the menu closed');
    });

    testWidgets('says Saved to My Notes', (tester) async {
      await run(tester, SaveResult.saved);
      expect(find.text('Saved to My Notes'), findsOneWidget);
    });

    testWidgets('says Already saved when it was', (tester) async {
      await run(tester, SaveResult.exists);
      expect(find.text('Already saved'), findsOneWidget);
      expect(find.text('Saved to My Notes'), findsNothing);
    });

    testWidgets('says so when it could not be saved, not that it was', (tester) async {
      await run(tester, SaveResult.failed);
      expect(find.text("Couldn't save"), findsOneWidget);
      expect(find.text('Saved to My Notes'), findsNothing);
    });
  });

  group('who a copy came from', () {
    testWidgets('a forward says Forwarded from the first writer', (tester) async {
      await pumpRow(tester, _msg(text: 'hi', forwardedFrom: {'uid': 'dan', 'name': 'Dan Cruz'}));
      expect(find.textContaining('Forwarded from', findRichText: true), findsOneWidget);
      expect(find.textContaining('Dan Cruz', findRichText: true), findsOneWidget);
      expect(find.byIcon(Icons.forward), findsOneWidget);
      expect(find.textContaining('Saved from', findRichText: true), findsNothing);
    });

    testWidgets('a saved note says Saved from the first writer', (tester) async {
      await pumpRow(tester, _msg(text: 'hi', forwardedFrom: {'name': 'Dan Cruz'}, savedFrom: {'route': null}));
      expect(find.textContaining('Saved from', findRichText: true), findsOneWidget);
      expect(find.textContaining('Dan Cruz', findRichText: true), findsOneWidget);
      expect(find.byIcon(Icons.bookmark_border), findsOneWidget);
      expect(find.textContaining('Forwarded from', findRichText: true), findsNothing);
    });

    testWidgets('an ordinary message has no label', (tester) async {
      await pumpRow(tester, _msg(text: 'hi'));
      expect(find.textContaining('from', findRichText: true), findsNothing);
      expect(find.byIcon(Icons.forward), findsNothing);
    });

    testWidgets('a label with no usable name is not shown', (tester) async {
      await pumpRow(tester, _msg(text: 'hi', forwardedFrom: {'name': '   '}));
      expect(find.textContaining('from', findRichText: true), findsNothing);
    });
  });

  group('the pieces, pinned (the chat screen and the Firestore write cannot run in a widget test)', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the screen offers saving everywhere except inside My Notes', () {
      expect(
        read('lib/widgets/chat/chat_surface.dart').contains(
          "onSave: widget.path.startsWith('users/')\n                      ? null\n                      : controller.saveToNotes,",
        ),
        isTrue,
      );
    });

    test('the list passes it on to each row', () {
      expect(read('lib/widgets/chat/message_list.dart').contains('onSave: widget.onSave,'), isTrue);
    });

    test('the controller saves with who is signed in, the directory for names, and this chat\'s path', () {
      final s = read('lib/providers/messages_providers.dart');
      expect(
        s.contains(
          '  Future<SaveResult> saveToNotes(ChatMessage message) async {\n'
          '    final me = _ref.read(profileProvider).valueOrNull;\n'
          '    final id = savedNoteId(message.id);\n'
          '    final payload = savedPayload(message, _ref.read(usersByIdProvider), path);\n'
          '    if (me == null || id == null || payload == null) return SaveResult.failed;\n'
          '    try {\n'
          '      return await _repo.saveMessageToNotes(me, id, payload);\n'
          '    } catch (_) {\n'
          '      return SaveResult.failed;\n'
          '    }\n'
          '  }',
        ),
        isTrue,
      );
    });

    test('the write is the web\'s: an existing note is left alone, and the same fields are written into the person\'s own notes', () {
      final s = read('lib/services/messages_repository.dart');
      expect(
        s.contains(
          "    final ref = _db\n"
          "        .collection('users')\n"
          "        .doc(me.id)\n"
          "        .collection('notes')\n"
          "        .doc(noteId);\n"
          "    if ((await ref.get()).exists) return SaveResult.exists;\n",
        ),
        isTrue,
      );
      expect(
        s.contains(
          "    await ref.set({\n"
          "      'text': c.text,\n"
          "      'imageURL': c.imageURL,\n"
          "      'imageMeta': c.imageMeta?.toMap(),\n"
          "      'audioURL': c.voice?.dataUrl,\n"
          "      'audioMeta': c.voice == null\n"
          "          ? null\n"
          "          : {'durationMs': c.voice!.durationMs, 'mime': c.voice!.storedMime},\n"
          "      'author': {'uid': me.id, 'name': me.name, 'photoURL': me.photoURL},\n"
          "      'mentionedUids': <String>[],\n"
          "      'replyTo': null,\n"
          "      'forwardedFrom': c.forwardedFrom.toMap(),\n"
          "      'savedFrom': {'route': saved.route},\n"
          "      'createdAt': FieldValue.serverTimestamp(),\n"
          "      'pinned': false,\n"
          "    });\n"
          "    return SaveResult.saved;",
        ),
        isTrue,
      );
    });
  });
}
