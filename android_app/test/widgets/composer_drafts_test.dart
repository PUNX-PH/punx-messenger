import 'dart:typed_data';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/services/draft_store.dart';
import 'package:punx_messenger/widgets/chat/composer.dart';

// Backing out of a chat disposes its message box. These prove that what was typed
// is there when the chat is opened again, and gone once it has been sent.

Future<void> okSend({
  required String text,
  Uint8List? imageBytes,
  String? imageName,
  String? remoteImageUrl,
  Map<String, dynamic>? remoteImageMeta,
}) async {}

Widget host({
  required DraftStore drafts,
  required String? key,
  ComposerSend? onSend,
  Key? widgetKey,
}) => MaterialApp(
  home: Scaffold(
    body: Align(
      alignment: Alignment.bottomCenter,
      child: Composer(
        key: widgetKey,
        placeholder: 'Message',
        onSend: onSend ?? okSend,
        users: const [],
        drafts: drafts,
        draftKey: key,
      ),
    ),
  ),
);

class _CountingStore extends DraftStore {
  _CountingStore() : super(null, saveDelay: Duration.zero);
  int sets = 0;
  @override
  void set(String? key, String text) {
    sets++;
    super.set(key, text);
  }
}

String boxText(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!.text;

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets('what you typed is there when you come back to the chat', (
    tester,
  ) async {
    final drafts = DraftStore.inMemory();
    await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/a/messages'));
    await tester.enterText(find.byType(TextField), 'half a message');
    await tester.pump();

    // Back out of the chat: the box is disposed.
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    // Open it again: a new box.
    await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/a/messages'));
    expect(boxText(tester), 'half a message');
  });

  testWidgets('a different conversation starts with an empty box', (
    tester,
  ) async {
    final drafts = DraftStore.inMemory();
    await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/a/messages'));
    await tester.enterText(find.byType(TextField), 'for A');
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/b/messages'));
    expect(boxText(tester), '');
  });

  testWidgets('another account on the same phone does not see the draft', (
    tester,
  ) async {
    final drafts = DraftStore.inMemory();
    await tester.pumpWidget(host(drafts: drafts, key: 'ana:dms/x/messages'));
    await tester.enterText(find.byType(TextField), 'private to ana');
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    await tester.pumpWidget(host(drafts: drafts, key: 'ben:dms/x/messages'));
    expect(boxText(tester), '');
  });

  testWidgets('a sent message does not come back as a draft', (tester) async {
    final drafts = DraftStore.inMemory();
    await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/a/messages'));
    await tester.enterText(find.byType(TextField), 'sending this');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();
    expect(boxText(tester), '');
    expect(drafts.get('me:dms/a/messages'), '');

    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/a/messages'));
    expect(boxText(tester), '');
  });

  testWidgets('a send that fails keeps the text, so it can be retried', (
    tester,
  ) async {
    final drafts = DraftStore.inMemory();
    await tester.pumpWidget(
      host(
        drafts: drafts,
        key: 'me:dms/a/messages',
        onSend:
            ({
              required text,
              imageBytes,
              imageName,
              remoteImageUrl,
              remoteImageMeta,
            }) async {
              throw FirebaseException(
                plugin: 'cloud_firestore',
                code: 'unavailable',
              );
            },
      ),
    );
    await tester.enterText(find.byType(TextField), 'not sent yet');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();
    expect(boxText(tester), 'not sent yet');
    expect(drafts.get('me:dms/a/messages'), 'not sent yet');
  });

  testWidgets('clearing the box clears the draft', (tester) async {
    final drafts = DraftStore.inMemory();
    await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/a/messages'));
    await tester.enterText(find.byType(TextField), 'oops');
    await tester.pump();
    expect(drafts.get('me:dms/a/messages'), 'oops');
    await tester.enterText(find.byType(TextField), '');
    await tester.pump();
    expect(drafts.get('me:dms/a/messages'), '');
  });

  testWidgets('with no draft store or key the box works as it always did', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: Composer(
              placeholder: 'Message',
              onSend: okSend,
              users: const [],
            ),
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), 'plain');
    await tester.pump();
    expect(boxText(tester), 'plain');
  });

  testWidgets('moving the cursor is not an edit, so it saves nothing', (
    tester,
  ) async {
    final drafts = _CountingStore()..set('me:dms/a/messages', 'some text');
    drafts.sets = 0;
    await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/a/messages'));
    expect(drafts.sets, 0, reason: 'restoring is not an edit either');
    final c = tester.widget<TextField>(find.byType(TextField)).controller!;
    c.selection = const TextSelection.collapsed(offset: 2);
    await tester.pump();
    expect(drafts.sets, 0);
    await tester.enterText(find.byType(TextField), 'some text!');
    await tester.pump();
    expect(drafts.sets, 1);
  });

  testWidgets(
    'restoring a draft puts the cursor at the end, ready to carry on',
    (tester) async {
      final drafts = DraftStore.inMemory()
        ..set('me:dms/a/messages', 'carry on');
      await tester.pumpWidget(host(drafts: drafts, key: 'me:dms/a/messages'));
      final c = tester.widget<TextField>(find.byType(TextField)).controller!;
      expect(c.selection.baseOffset, 'carry on'.length);
    },
  );
}
