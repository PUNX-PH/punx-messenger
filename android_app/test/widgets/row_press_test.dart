import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';

ChatMessage msg(String text, {String? imageURL}) => ChatMessage(
  id: 'm1',
  author: const MessageAuthor(uid: 'ana', name: 'Ana'),
  text: text,
  imageURL: imageURL,
  createdAt: Timestamp.fromDate(DateTime(2026, 11, 19, 10)),
);

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<void> pump(WidgetTester tester, ChatMessage m, {bool showHeader = true}) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
        child: MaterialApp(
          home: Scaffold(
            body: Align(
              alignment: Alignment.topCenter,
              child: MessageRow(
                message: m,
                showHeader: showHeader,
                meUid: 'me',
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
                onReply: (_) {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// A long press at [dx] from the row's left edge, halfway down it.
  Future<void> pressAt(WidgetTester tester, double dx) async {
    final box = tester.getRect(find.byType(MessageRow));
    await tester.longPressAt(Offset(box.left + dx, box.center.dy));
    await tester.pumpAndSettle();
  }

  group('pressing anywhere on a message row opens its menu', () {
    testWidgets('on its text (it always did)', (tester) async {
      await pump(tester, msg('hi'));
      await tester.longPress(find.text('hi', findRichText: true));
      await tester.pumpAndSettle();
      expect(find.text('Reply'), findsOneWidget);
    });

    testWidgets('on the empty space to the right of a short message', (tester) async {
      await pump(tester, msg('hi'));
      await pressAt(tester, 330);
      expect(find.text('Reply'), findsOneWidget, reason: 'a thumb does not aim for the words');
    });

    testWidgets('under the avatar, on the left edge', (tester) async {
      await pump(tester, msg('hi'), showHeader: false);
      await pressAt(tester, 20);
      expect(find.text('Reply'), findsOneWidget);
    });

    testWidgets('on the gap between the lines of a message with a header', (tester) async {
      await pump(tester, msg('hi'));
      final box = tester.getRect(find.byType(MessageRow));
      await tester.longPressAt(Offset(box.right - 8, box.top + 4));
      await tester.pumpAndSettle();
      expect(find.text('Reply'), findsOneWidget);
    });
  });

  group('wiring', () {
    test('the whole row is what is pressed, not only what is painted in it', () {
      final s = File('lib/widgets/chat/message_row.dart').readAsStringSync().replaceAll('\r\n', '\n');
      expect(s.contains('    return GestureDetector(\n      behavior: HitTestBehavior.opaque,\n      onLongPress: () => _showActions(context),'), isTrue);
    });
  });
}
