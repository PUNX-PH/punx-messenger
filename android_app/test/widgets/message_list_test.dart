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
    String? newFromId,
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
                newFromId: newFromId,
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

  group('the New line', () {
    final now = DateTime.now();
    // Three by Ana within a minute: one group, unless something splits it.
    List<ChatMessage> trio() => [
      _msg('m0', _ana, now.subtract(const Duration(seconds: 50))),
      _msg('m1', _ana, now.subtract(const Duration(seconds: 40))),
      _msg('m2', _ana, now.subtract(const Duration(seconds: 30))),
    ];

    testWidgets('is drawn once, above the first unread message', (
      tester,
    ) async {
      await pump(tester, trio(), newFromId: 'm2');
      expect(find.text('NEW'), findsOneWidget);
      final line = tester.getTopLeft(find.text('NEW')).dy;
      expect(
        line,
        lessThan(
          tester.getTopLeft(find.text('message m2', findRichText: true)).dy,
        ),
        reason: 'above m2',
      );
      expect(
        line,
        greaterThan(
          tester.getTopLeft(find.text('message m1', findRichText: true)).dy,
        ),
        reason: 'below m1',
      );
    });

    testWidgets('starts a new group, so the same person is named again', (
      tester,
    ) async {
      await pump(tester, trio());
      expect(find.text('Ana'), findsOneWidget, reason: 'one run, one header');
      await pump(tester, trio(), newFromId: 'm2');
      expect(find.text('Ana'), findsNWidgets(2));
    });

    testWidgets('no id, or an id that is not in the list, adds nothing', (
      tester,
    ) async {
      await pump(tester, trio());
      expect(find.text('NEW'), findsNothing);
      await pump(tester, trio(), newFromId: 'gone');
      expect(find.text('NEW'), findsNothing);
    });

    testWidgets('is announced to a screen reader as "New messages"', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await pump(tester, trio(), newFromId: 'm2');
      expect(find.bySemanticsLabel('New messages'), findsOneWidget);
      handle.dispose();
    });

    group('Jump to first unread', () {
      // The line is far above the screen once the list has settled at the bottom.
      testWidgets('is offered when the line is out of sight above', (
        tester,
      ) async {
        await pump(tester, _history(80), newFromId: 'm10');
        expect(find.text('Jump to first unread'), findsOneWidget);
      });

      testWidgets('is not offered when the line is on screen', (tester) async {
        await pump(tester, trio(), newFromId: 'm2');
        expect(find.text('Jump to first unread'), findsNothing);
      });

      testWidgets('is not offered when there is no line', (tester) async {
        await pump(tester, _history(80));
        expect(find.text('Jump to first unread'), findsNothing);
      });

      testWidgets('takes you to the line and goes away', (tester) async {
        await pump(tester, _history(120), newFromId: 'm5');
        await tester.tap(find.text('Jump to first unread'));
        await tester.pumpAndSettle();
        expect(find.text('NEW'), findsOneWidget, reason: 'the line is built');
        final top = tester.getTopLeft(find.text('NEW')).dy;
        expect(top, greaterThanOrEqualTo(0));
        expect(top, lessThan(300), reason: 'near the top of the screen');
        expect(find.text('Jump to first unread'), findsNothing);
      });

      testWidgets(
        'works from a very long way down, through rows not built yet',
        (tester) async {
          await pump(tester, _history(400), newFromId: 'm3');
          await tester.tap(find.text('Jump to first unread'));
          await tester.pumpAndSettle();
          expect(find.text('NEW'), findsOneWidget);
          expect(find.text('Jump to first unread'), findsNothing);
        },
      );

      testWidgets('is not offered once you have scrolled above the line', (
        tester,
      ) async {
        await pump(tester, _history(120), newFromId: 'm60');
        await tester.tap(find.text('Jump to first unread'));
        await tester.pumpAndSettle();
        await tester.drag(find.byType(ListView), const Offset(0, 3000));
        await tester.pumpAndSettle();
        expect(find.text('Jump to first unread'), findsNothing);
      });

      testWidgets('comes back when you scroll down past the line again', (
        tester,
      ) async {
        await pump(tester, _history(120), newFromId: 'm20');
        await tester.tap(find.text('Jump to first unread'));
        await tester.pumpAndSettle();
        await tester.drag(find.byType(ListView), const Offset(0, -4000));
        await tester.pumpAndSettle();
        expect(find.text('Jump to first unread'), findsOneWidget);
      });

      testWidgets('a message arriving meanwhile does not pull the view away', (
        tester,
      ) async {
        final msgs = _history(120);
        final feed = await pump(tester, msgs, newFromId: 'm5');
        await tester.tap(find.text('Jump to first unread'));
        await tester.pumpAndSettle();
        final before = tester.getTopLeft(find.text('NEW')).dy;

        feed.value = [...msgs, _msg('n1', _ben, DateTime.now())];
        await tester.pumpAndSettle();
        expect(find.text('NEW'), findsOneWidget, reason: 'still where it was');
        expect(tester.getTopLeft(find.text('NEW')).dy, closeTo(before, 1));
        expect(find.text('1 new message'), findsOneWidget);
      });

      // Rows of very different heights: tall first, short after (or the reverse).
      // The first guess at where the line is comes from its index, so it lands short
      // of the line in one case and past it in the other, and the jump has to step
      // the right way from either. One test each: a conversation switch builds a
      // fresh list in the app, which reusing one in a test would not.
      for (final c in [
        (
          name: 'tall rows first, so the guess falls short',
          tallFirst: true,
          line: 'm60',
        ),
        (
          name: 'short rows first, so the guess overshoots',
          tallFirst: false,
          line: 'm150',
        ),
      ]) {
        testWidgets(
          'finds the line through rows of very different heights: ${c.name}',
          (tester) async {
            final now = DateTime.now();
            final long = List.filled(
              40,
              'word',
            ).join(' '); // wraps to several lines
            await pump(tester, [
              for (var i = 0; i < 200; i++)
                _msg(
                  'm$i',
                  i.isEven ? _ana : _ben,
                  now.subtract(Duration(minutes: 200 - i)),
                  text: ((i < 100) == c.tallFirst) ? long : 'short',
                ),
            ], newFromId: c.line);
            expect(find.text('Jump to first unread'), findsOneWidget);
            await tester.tap(find.text('Jump to first unread'));
            await tester.pumpAndSettle();
            expect(find.text('NEW'), findsOneWidget);
            expect(find.text('Jump to first unread'), findsNothing);
          },
        );
      }

      testWidgets(
        'appears as soon as the line scrolls up past the top, while its row is still built',
        (tester) async {
          await pump(tester, _history(120), newFromId: 'm5');
          await tester.tap(find.text('Jump to first unread'));
          await tester.pumpAndSettle();
          expect(find.text('Jump to first unread'), findsNothing);
          // Just past the top edge: the row still exists (the list builds a little
          // beyond the screen), so only a measurement can tell it is out of sight.
          await tester.drag(find.byType(ListView), const Offset(0, -200));
          await tester.pumpAndSettle();
          expect(find.text('Jump to first unread'), findsOneWidget);
        },
      );

      testWidgets(
        'is offered when the line is decided after the list is showing',
        (tester) async {
          tester.view.physicalSize = const Size(390, 844);
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.reset);
          final newFrom = ValueNotifier<String?>(null);
          final msgs = _history(80);
          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                statusOfProvider.overrideWith((ref, uid) => 'online'),
              ],
              child: MaterialApp(
                home: Scaffold(
                  body: ValueListenableBuilder<String?>(
                    valueListenable: newFrom,
                    builder: (_, id, _) => MessageListView(
                      messages: msgs,
                      meUid: 'me',
                      usersById: const {},
                      emojiByName: const {},
                      canDeleteAny: false,
                      emptyTitle: 'Nothing here',
                      emptyDesc: 'Say something',
                      newFromId: id,
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.text('Jump to first unread'), findsNothing);
          newFrom.value = 'm10';
          await tester.pumpAndSettle();
          expect(find.text('Jump to first unread'), findsOneWidget);
        },
      );

      testWidgets(
        'appears on a scroll that adds and removes no rows (very tall messages)',
        (tester) async {
          final now = DateTime.now();
          // Each message is several screens tall, so only a few rows are ever built
          // and a short scroll changes none of them: the only thing that can notice
          // the line has gone over the top is the scroll itself.
          final huge = List.filled(900, 'word').join(' ');
          await pump(tester, [
            for (var i = 0; i < 12; i++)
              _msg(
                'm$i',
                i.isEven ? _ana : _ben,
                now.subtract(Duration(minutes: 12 - i)),
                text: huge,
              ),
          ], newFromId: 'm4');
          await tester.tap(find.text('Jump to first unread'));
          await tester.pumpAndSettle();
          expect(find.text('Jump to first unread'), findsNothing);
          await tester.drag(find.byType(ListView), const Offset(0, -150));
          await tester.pumpAndSettle();
          expect(find.text('Jump to first unread'), findsOneWidget);
        },
      );

      testWidgets('is also read out as a button', (tester) async {
        final handle = tester.ensureSemantics();
        await pump(tester, _history(80), newFromId: 'm10');
        expect(find.bySemanticsLabel('Jump to first unread'), findsOneWidget);
        handle.dispose();
      });
    });
  });
}
