import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/custom_emoji.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/models/reply_snapshot.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/utils/forward_targets.dart';
import 'package:punx_messenger/widgets/chat/message_renderer.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';
import 'package:punx_messenger/widgets/chat/pinned_messages_sheet.dart';
import 'package:punx_messenger/widgets/chat/search_sheet.dart';

final users = {
  'abcdef12': UserProfile(id: 'abcdef12', email: 'a@x.test', name: 'Ana Reyes', role: Role.employee),
};

ChatMessage msg(String id, {String text = '', String? snippet, bool pinned = false}) => ChatMessage(
  id: id,
  author: const MessageAuthor(uid: 'ana', name: 'Ana'),
  text: text,
  pinned: pinned,
  replyTo: snippet == null ? null : ReplySnapshot(messageId: 'q', authorName: 'Ben', snippet: snippet),
  createdAt: Timestamp.fromDate(DateTime(2026, 11, 19, 10)),
);

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
    // A press that lands on nothing must fail the test, not pass it by doing nothing.
    WidgetController.hitTestWarningShouldBeFatal = true;
  });

  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
  }

  Future<void> pumpText(WidgetTester tester, String text) async {
    phone(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MessageRenderer(text: text, emojiByName: const {}, usersById: users),
        ),
      ),
    );
  }

  Finder bars() => find.bySemanticsLabel('Spoiler, press to show');
  Finder hiddenLayer() => find.byWidgetPredicate((w) => w is Opacity && w.opacity == 0);
  // The bar itself: what is pressed (the layer inside it is ignored by touches, on purpose).
  Finder bar() => find.ancestor(of: hiddenLayer(), matching: find.byType(GestureDetector));

  group('a spoiler in a message', () {
    testWidgets('is hidden until pressed: laid out, not painted', (tester) async {
      await pumpText(tester, 'The ending is ||the butler|| so do not tell');
      expect(hiddenLayer(), findsOneWidget);
      expect(find.textContaining('The ending is', findRichText: true), findsOneWidget);
    });

    testWidgets('pressing it shows the text, for good', (tester) async {
      await pumpText(tester, 'The ending is ||the butler|| so do not tell');
      await tester.tap(bar());
      await tester.pumpAndSettle();
      expect(hiddenLayer(), findsNothing);
      expect(find.text('the butler', findRichText: true), findsOneWidget);
      // and pressing the text does not hide it again
      await tester.tap(find.text('the butler', findRichText: true));
      await tester.pumpAndSettle();
      expect(hiddenLayer(), findsNothing);
    });

    testWidgets('each one is its own: pressing the first leaves the second hidden', (tester) async {
      await pumpText(tester, '||first|| and ||second||');
      expect(hiddenLayer(), findsNWidgets(2));
      await tester.tap(bar().first);
      await tester.pumpAndSettle();
      expect(hiddenLayer(), findsOneWidget);
      await tester.tap(bar());
      await tester.pumpAndSettle();
      expect(hiddenLayer(), findsNothing);
    });

    testWidgets('what is inside is drawn like any text, then hidden with it: bold, mention', (tester) async {
      await pumpText(tester, '||**bold** <@abcdef12> and `code`||');
      expect(hiddenLayer(), findsOneWidget);
      expect(find.descendant(of: hiddenLayer(), matching: find.text('@Ana Reyes', findRichText: true)), findsOneWidget);
      await tester.tap(bar());
      await tester.pumpAndSettle();
      expect(find.text('@Ana Reyes', findRichText: true), findsOneWidget);
      expect(find.text('code', findRichText: true), findsOneWidget);
    });

    testWidgets('a link inside cannot be pressed while it is hidden', (tester) async {
      await pumpText(tester, '||see https://example.com/secret||');
      final ignoring = find.ancestor(of: hiddenLayer(), matching: find.byType(IgnorePointer));
      expect(tester.widget<IgnorePointer>(ignoring.first).ignoring, isTrue);
    });

    testWidgets('for a screen reader it is a button, "Spoiler, press to show", and what is behind it is not read', (tester) async {
      final semantics = tester.ensureSemantics();
      await pumpText(tester, 'ending: ||the butler||');
      expect(bars(), findsOneWidget);
      final node = tester.getSemantics(bars());
      expect(node.getSemanticsData().flagsCollection.isButton, isTrue);
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
      expect(find.bySemanticsLabel(RegExp('butler')), findsNothing, reason: 'not read out while hidden');
      semantics.dispose();
    });

    testWidgets('a screen reader can press it, and then reads the text', (tester) async {
      final semantics = tester.ensureSemantics();
      await pumpText(tester, 'ending: ||the butler||');
      tester.semantics.tap(find.semantics.byLabel('Spoiler, press to show'));
      await tester.pumpAndSettle();
      expect(bars(), findsNothing);
      expect(hiddenLayer(), findsNothing);
      semantics.dispose();
    });

    testWidgets('things that only look like a spoiler are plain text, with no bar', (tester) async {
      await pumpText(tester, 'a || b || c and x || y');
      expect(hiddenLayer(), findsNothing);
      expect(find.textContaining('a || b || c', findRichText: true), findsOneWidget);
    });

    testWidgets('code keeps its bars', (tester) async {
      await pumpText(tester, '`a||b||c` stays');
      expect(hiddenLayer(), findsNothing);
      expect(find.text('a||b||c', findRichText: true), findsOneWidget);
    });

    testWidgets('an emoji inside keeps the size the message gave it, hidden or shown', (tester) async {
      phone(tester);
      const png =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: MessageRenderer(
              text: '||:fire:||',
              emojiByName: {'fire': CustomEmoji(id: 'e', name: 'fire', dataURL: png)},
              usersById: {},
              emojiSize: 40,
            ),
          ),
        ),
      );
      expect(tester.getSize(find.byType(Image)), const Size(40, 40));
      await tester.tap(bar());
      await tester.pumpAndSettle();
      expect(tester.getSize(find.byType(Image)), const Size(40, 40));
    });

    testWidgets('a long one wraps inside its bar instead of overflowing', (tester) async {
      await pumpText(tester, 'x ||${List.filled(60, 'secret').join(' ')}|| y');
      expect(tester.takeException(), isNull);
      expect(hiddenLayer(), findsOneWidget);
    });
  });

  group('wherever text is shown as plain text, it stays hidden', () {
    testWidgets('the quote in a reply, even one an older client wrote', (tester) async {
      phone(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
          child: MaterialApp(
            home: Scaffold(
              body: MessageRow(
                message: msg('r', text: 'answer', snippet: 'the end: ||dies|| ok'),
                showHeader: true,
                meUid: 'me',
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
              ),
            ),
          ),
        ),
      );
      expect(find.text('the end: [spoiler] ok'), findsOneWidget);
      expect(find.textContaining('dies'), findsNothing);
    });

    test('a message\'s preview (the reply quote when written, the "replying to" bar)', () {
      expect(msg('a', text: 'the end: ||dies||').previewText, 'the end: [spoiler]');
      expect(msg('a', text: 'plain').previewText, 'plain');
      expect(msg('a', text: '||only||').previewText, '[spoiler]');
    });

    test('the preview of a forward', () {
      expect(forwardPreviewLine('the end: ||dies||', hasVoice: false), 'the end: [spoiler]');
      expect(forwardPreviewLine('a || b || c', hasVoice: false), 'a || b || c');
    });

    testWidgets('the pinned list', (tester) async {
      phone(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: ElevatedButton(
                onPressed: () => showPinnedMessagesSheet(
                  context,
                  messages: [msg('p', text: 'the end: ||dies||', pinned: true)],
                  canPin: false,
                  onJump: (_) {},
                  onUnpin: (_) {},
                ),
                child: const Text('pinned'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('pinned'));
      await tester.pumpAndSettle();
      expect(find.text('the end: [spoiler]'), findsOneWidget);
      expect(find.textContaining('dies'), findsNothing);
    });

    testWidgets('search results (found by what is in it, shown as [spoiler])', (tester) async {
      phone(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: ElevatedButton(
                onPressed: () => showSearchSheet(
                  context,
                  messages: [msg('s', text: 'the end: ||dies||')],
                  usersById: const {},
                  onJump: (_) {},
                ),
                child: const Text('search'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('search'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'end');
      await tester.pumpAndSettle();
      expect(find.text('the end: [spoiler]'), findsOneWidget);
      expect(find.textContaining('dies'), findsNothing);
    });
  });

  group('wiring (Firestore and notifications cannot run in a widget test)', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the conversation preview written to a DM does not hold the spoiler', () {
      expect(read('lib/services/messages_repository.dart').contains("          'lastMessageText': trimmed.isNotEmpty\n              ? hideSpoilers(trimmed)\n"), isTrue);
    });

    test('the reply quote is written from the hidden preview', () {
      expect(read('lib/services/messages_repository.dart').contains('final rawSnippet = replyTo.previewText;'), isTrue);
      expect(read('lib/models/message.dart').contains('  String get previewText => text.isNotEmpty\n      ? hideSpoilers(text)\n'), isTrue);
    });

    test('a DM notification does not say what is hidden, even from an older client', () {
      expect(read('lib/services/notification_listener_service.dart').contains("    final body = hideSpoilers((data['lastMessageText'] as String?) ?? '');"), isTrue);
    });

    test('copying a message still copies what was written, and forwarding sends the original', () {
      expect(read('lib/utils/copy_text.dart').contains('hideSpoilers'), isFalse);
      expect(read('lib/utils/forward.dart').contains('hideSpoilers'), isFalse);
    });

    test('the parser gets its pieces in a fixed order with spoilers last', () {
      final s = read('lib/markdown/message_parser.dart');
      expect(s.contains("    r'(<@[A-Za-z0-9_-]{6,40}>)', // 8 mention\n    '(\$spoilerSource)', // 9 spoiler: last, so nothing else moves\n"), isTrue);
      expect(s.contains('      tokens.add(SpoilerToken(_parseInline(spoilerInner(spoiler))));'), isTrue);
    });
  });
}
