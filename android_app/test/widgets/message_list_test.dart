import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/widgets/chat/message_list.dart';

const _ana = MessageAuthor(uid: 'ana', name: 'Ana');
const _ben = MessageAuthor(uid: 'ben', name: 'Ben');

ChatMessage _msg(
  String id,
  MessageAuthor author,
  DateTime at, {
  String? text,
}) => ChatMessage(
  id: id,
  author: author,
  text: text ?? 'message $id',
  createdAt: Timestamp.fromDate(at),
);

/// Many messages spread over [days] ending now, alternating authors, so the
/// list is tall enough to scroll and has day boundaries in it.
List<ChatMessage> _history(int count, {int days = 3}) {
  final now = DateTime.now();
  final start = now.subtract(Duration(days: days));
  final step = Duration(
    milliseconds: now.difference(start).inMilliseconds ~/ count,
  );
  return [
    for (var i = 0; i < count; i++)
      _msg('m$i', i.isEven ? _ana : _ben, start.add(step * i)),
  ];
}

void main() {
  setUpAll(() {
    // No network in tests: stop google_fonts trying to download Inter.
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  Future<ValueNotifier<List<ChatMessage>>> pump(
    WidgetTester tester,
    List<ChatMessage> messages, {
    String meUid = 'me',
    Size size = const Size(390, 844),
    double textScale = 1.0,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    tester.platformDispatcher.textScaleFactorTestValue = textScale;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearAllTestValues);

    final notifier = ValueNotifier<List<ChatMessage>>(messages);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          // The real one subscribes to a periodic timer, which a test would
          // then report as still pending.
          statusOfProvider.overrideWith((ref, uid) => 'online'),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: ValueListenableBuilder<List<ChatMessage>>(
              valueListenable: notifier,
              builder: (_, msgs, _) => MessageListView(
                messages: msgs,
                meUid: meUid,
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
                emptyTitle: 'Nothing here',
                emptyDesc: 'Say something',
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return notifier;
  }

  group('day dividers', () {
    testWidgets('label each day, and not a day twice', (tester) async {
      final now = DateTime.now();
      await pump(tester, [
        _msg('a', _ana, now.subtract(const Duration(days: 1))),
        _msg('b', _ben, now.subtract(const Duration(days: 1))),
        _msg('c', _ana, now),
      ]);
      expect(find.text('Yesterday'), findsOneWidget);
      expect(find.text('Today'), findsOneWidget);
    });

    testWidgets('a new day starts a new group even for the same author', (
      tester,
    ) async {
      final now = DateTime.now();
      // Same author a minute apart would normally share one header.
      final noon = DateTime(now.year, now.month, now.day, 12);
      await pump(tester, [
        _msg('a', _ana, noon.subtract(const Duration(days: 1))),
        _msg('b', _ana, noon),
      ]);
      expect(find.text('Ana'), findsNWidgets(2));
    });

    testWidgets('a pending message with no timestamp never opens a divider', (
      tester,
    ) async {
      final now = DateTime.now();
      await pump(tester, [
        _msg('a', _ana, now),
        const ChatMessage(id: 'pending', author: _ana, text: 'sending…'),
      ]);
      expect(find.text('Today'), findsOneWidget);
    });
  });

  group('jump to latest', () {
    testWidgets('not shown when you are at the bottom', (tester) async {
      await pump(tester, _history(60));
      expect(find.text('Jump to latest'), findsNothing);
    });

    testWidgets('shown once you have scrolled well up', (tester) async {
      await pump(tester, _history(60));
      await tester.drag(find.byType(ListView), const Offset(0, 1500));
      await tester.pumpAndSettle();
      expect(find.text('Jump to latest'), findsOneWidget);
    });

    testWidgets('counts what arrives while you are reading history', (
      tester,
    ) async {
      final msgs = _history(60);
      final feed = await pump(tester, msgs);
      await tester.drag(find.byType(ListView), const Offset(0, 1500));
      await tester.pumpAndSettle();

      feed.value = [...msgs, _msg('n1', _ben, DateTime.now())];
      await tester.pumpAndSettle();
      expect(find.text('1 new message'), findsOneWidget);

      feed.value = [
        ...feed.value,
        _msg('n2', _ben, DateTime.now().add(const Duration(seconds: 1))),
      ];
      await tester.pumpAndSettle();
      expect(find.text('2 new messages'), findsOneWidget);
    });

    testWidgets('tapping it returns to the end and clears the count', (
      tester,
    ) async {
      final msgs = _history(60);
      final feed = await pump(tester, msgs);
      await tester.drag(find.byType(ListView), const Offset(0, 1500));
      await tester.pumpAndSettle();
      feed.value = [...msgs, _msg('n1', _ben, DateTime.now())];
      await tester.pumpAndSettle();

      await tester.tap(find.text('1 new message'));
      await tester.pumpAndSettle();
      expect(find.textContaining('new message'), findsNothing);
      expect(find.text('Jump to latest'), findsNothing);
      expect(
        find.textContaining('message n1', findRichText: true),
        findsOneWidget,
      ); // scrolled into view
    });

    testWidgets('your own message scrolls you down and is not "new"', (
      tester,
    ) async {
      final msgs = _history(60);
      final feed = await pump(tester, msgs, meUid: 'me');
      await tester.drag(find.byType(ListView), const Offset(0, 1500));
      await tester.pumpAndSettle();

      feed.value = [
        ...msgs,
        _msg(
          'mine',
          const MessageAuthor(uid: 'me', name: 'Me'),
          DateTime.now(),
        ),
      ];
      await tester.pumpAndSettle();
      expect(find.textContaining('new message'), findsNothing);
      expect(
        find.textContaining('message mine', findRichText: true),
        findsOneWidget,
      );
    });

    testWidgets('deleting the newest message is not a new arrival', (
      tester,
    ) async {
      final msgs = _history(60);
      final feed = await pump(tester, msgs);
      await tester.drag(find.byType(ListView), const Offset(0, 1500));
      await tester.pumpAndSettle();

      feed.value = msgs.sublist(0, msgs.length - 1);
      await tester.pumpAndSettle();
      expect(find.textContaining('new message'), findsNothing);
    });

    testWidgets('older history landing at the top is not "new" either', (
      tester,
    ) async {
      final all = _history(80);
      final feed = await pump(tester, all.sublist(20));
      await tester.drag(find.byType(ListView), const Offset(0, 1500));
      await tester.pumpAndSettle();

      feed.value = all; // 20 older messages prepended; newest unchanged
      await tester.pumpAndSettle();
      expect(find.textContaining('new message'), findsNothing);
    });

    // A ListView only knows the height of rows it has built and estimates the
    // rest, so with wildly different row heights the "end" it reports before
    // scrolling is not the end it reports after. The feed must still land on the
    // real bottom, both on open and when a message arrives.
    testWidgets('lands on the true bottom when row heights vary a lot', (
      tester,
    ) async {
      final now = DateTime.now();
      List<ChatMessage> varied(int n) => [
        for (var i = 0; i < n; i++)
          _msg(
            'v$i',
            i.isEven ? _ana : _ben,
            now.subtract(Duration(minutes: n - i)),
            // Mostly one-liners, with a very tall message every few rows.
            text: i % 5 == 0
                ? List.generate(40, (l) => 'line $l of message $i').join('\n')
                : 'short $i',
          ),
      ];

      double gapToEnd() {
        final p = tester
            .state<ScrollableState>(find.byType(Scrollable).first)
            .position;
        return p.maxScrollExtent - p.pixels;
      }

      final msgs = varied(80);
      final feed = await pump(tester, msgs);
      expect(gapToEnd(), lessThan(2), reason: 'on open');

      feed.value = [
        ...msgs,
        _msg('last', _ben, now.add(const Duration(minutes: 1)), text: 'newest'),
      ];
      await tester.pumpAndSettle();
      expect(gapToEnd(), lessThan(2), reason: 'after a message arrives');
      expect(find.textContaining('newest', findRichText: true), findsOneWidget);
    });

    testWidgets('while at the bottom, new messages just follow', (
      tester,
    ) async {
      final msgs = _history(60);
      final feed = await pump(tester, msgs);
      feed.value = [...msgs, _msg('n1', _ben, DateTime.now())];
      await tester.pumpAndSettle();
      expect(find.textContaining('new message'), findsNothing);
      expect(
        find.textContaining('message n1', findRichText: true),
        findsOneWidget,
      );
    });
  });

  // Layout across devices. Flutter fails any test in which a RenderFlex
  // overflows, so rendering the real widgets at each size is the check: it
  // cannot see how a screen LOOKS, but it does catch text that no longer fits.
  group('fits every device', () {
    const sizes = <String, Size>{
      'small phone 320x568': Size(320, 568),
      'phone 360x640': Size(360, 640),
      'large phone 412x915': Size(412, 915),
      'phone landscape 844x390': Size(844, 390),
      'small landscape 568x320': Size(568, 320),
      'tablet 768x1024': Size(768, 1024),
      'tablet landscape 1280x800': Size(1280, 800),
    };
    const scales = [1.0, 1.5, 2.0];

    for (final entry in sizes.entries) {
      for (final scale in scales) {
        testWidgets('${entry.key} at ${scale}x text', (tester) async {
          final now = DateTime.now();
          await pump(
            tester,
            [
              _msg(
                'long',
                _ana,
                now.subtract(const Duration(days: 400)),
                text:
                    'A long message with a link https://example.com/a/very/long/path/that/keeps/going and more words to wrap',
              ),
              ..._history(20, days: 2),
            ],
            size: entry.value,
            textScale: scale,
          );
          expect(tester.takeException(), isNull);

          // Scroll to the very top, where the year-old message is: its divider
          // ("Tuesday, September 30, 2025") is the longest label there is, so
          // it is the one most likely to overflow.
          for (var i = 0; i < 4; i++) {
            await tester.drag(find.byType(ListView), const Offset(0, 4000));
            await tester.pumpAndSettle();
          }
          expect(tester.takeException(), isNull);
          expect(
            find.byWidgetPredicate(
              (w) => w is Text && RegExp(r', \d{4}$').hasMatch(w.data ?? ''),
            ),
            findsOneWidget,
          );
        });
      }
    }
  });
}
