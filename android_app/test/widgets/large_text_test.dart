import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/forwarded_from.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/models/reply_snapshot.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/models/voice_clip.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/emojis_providers.dart';
import 'package:punx_messenger/providers/messages_providers.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/providers/users_providers.dart';
import 'package:punx_messenger/services/messages_repository.dart';
import 'package:punx_messenger/utils/attachments.dart';
import 'package:punx_messenger/widgets/chat/composer.dart';
import 'package:punx_messenger/widgets/chat/format_bar.dart';
import 'package:punx_messenger/widgets/chat/message_list.dart';
import 'package:punx_messenger/widgets/chat/message_renderer.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';
import 'package:punx_messenger/widgets/chat/search_sheet.dart';
import 'package:punx_messenger/widgets/chat/thread_screen.dart';

// The screens added for threads, pictures, search, spoilers and formatting, on a small phone with the
// text turned up: nothing may overflow or throw. (The size is a phone's, the text scale is the
// accessibility setting "largest text".)

final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
);

const _longName = 'Alexandria Montgomery-Featherstonehaugh the Third';

ChatMessage msg(
  String id, {
  String text =
      'a message of some length that will need more than one line on a small phone',
  String? to,
  String uid = 'ana',
  String name = _longName,
  int minute = 0,
  bool pinned = false,
  bool edited = false,
  Map<String, List<String>> reactions = const {},
}) => ChatMessage(
  id: id,
  author: MessageAuthor(uid: uid, name: name),
  text: text,
  replyTo: to == null
      ? null
      : ReplySnapshot(
          messageId: to,
          authorName: _longName,
          snippet:
              'the quoted words, which are also much longer than a small phone can hold on one line',
        ),
  forwardedFrom: null,
  pinned: pinned,
  editedAt: edited ? Timestamp.fromMillisecondsSinceEpoch(5) : null,
  reactions: reactions,
  createdAt: Timestamp.fromDate(DateTime(2026, 11, 19, 10, minute)),
);

class _FakeRepo implements MessagesRepository {
  @override
  Future<void> sendMessage(
    String path, {
    required String text,
    required UserProfile author,
    Uint8List? imageBytes,
    String? imageName,
    ChatMessage? replyTo,
    String? remoteImageUrl,
    Map<String, dynamic>? remoteImageMeta,
    VoiceClip? voice,
    ForwardedFrom? forwardedFrom,
  }) async {}

  @override
  Future<void> setTyping(
    String containerPath,
    String uid,
    bool isTyping,
  ) async {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final _me = UserProfile(
  id: 'me',
  email: 'me@x.test',
  name: 'Me',
  role: Role.employee,
);
const _path = 'groups/g/channels/c/messages';

typedef Screen = ({double w, double h, double scale});
const screens = <Screen>[
  (w: 320, h: 568, scale: 2.0), // a small phone, "largest text"
  (w: 360, h: 640, scale: 1.3),
  (w: 320, h: 568, scale: 1.0),
];

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<void> show(
    WidgetTester tester,
    Screen s,
    Widget home, {
    List<Override> overrides = const [],
  }) async {
    tester.view.physicalSize = Size(s.w, s.h);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          statusOfProvider.overrideWith((ref, uid) => 'online'),
          ...overrides,
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(s.scale)),
            child: child!,
          ),
          home: home,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// Scrolls the sheet's list, from the top, until [target] is on screen; fails if it never is. (By the
  /// scroll position and not by dragging: a drag on a bottom sheet can close the sheet instead.)
  Future<void> reveal(WidgetTester tester, Finder target) async {
    final position = tester
        .state<ScrollableState>(
          find.descendant(
            of: find.byType(ListView),
            matching: find.byType(Scrollable),
          ),
        )
        .position;
    for (var at = 0.0; ; at += 40) {
      position.jumpTo(
        at < position.maxScrollExtent ? at : position.maxScrollExtent,
      );
      await tester.pump();
      if (target.evaluate().isNotEmpty) return;
      if (at >= position.maxScrollExtent) {
        fail('${target.describeMatch(Plurality.zero)} cannot be reached by scrolling the list');
      }
    }
  }

  /// Everything that went wrong while drawing: overflows and anything thrown.
  List<String> problems(WidgetTester tester) {
    final out = <String>[];
    Object? e;
    while ((e = tester.takeException()) != null) {
      final text = e.toString();
      out.add(
        text.split('\n').first,
      ); // says how much it overflowed and by how many pixels
    }
    return out;
  }

  void scene(
    String name,
    Future<void> Function(WidgetTester tester, Screen s) body,
  ) {
    for (final s in screens) {
      testWidgets('$name at ${s.w.toInt()}x${s.h.toInt()}, text ${s.scale}x', (
        tester,
      ) async {
        await body(tester, s);
        expect(problems(tester), isEmpty);
      });
    }
  }

  scene(
    'a message row with a reply quote, the thread chip and the new pill, a long name and every marker',
    (tester, s) async {
      await show(
        tester,
        s,
        Scaffold(
          body: SingleChildScrollView(
            child: MessageRow(
              message: msg(
                'm',
                to: 'q',
                pinned: true,
                edited: true,
                reactions: {
                  '👍': ['a', 'b'],
                  '🎉': ['c'],
                },
              ),
              showHeader: true,
              meUid: 'me',
              usersById: const {},
              emojiByName: const {},
              canDeleteAny: false,
              replyCount: 128,
              newReplyCount: 99,
              onOpenThread: (_) {},
              onReact: (_, _) {},
              seenText: 'Seen 10:42 AM, a little while ago',
            ),
          ),
        ),
      );
    },
  );

  scene('the message list with threads, new replies and a long run', (
    tester,
    s,
  ) async {
    final q = msg('q', text: 'the question');
    await show(
      tester,
      s,
      Scaffold(
        body: MessageListView(
          messages: [
            q,
            msg('r1', to: 'q', uid: 'cy', name: 'Cy', minute: 5),
            msg('r2', to: 'q', uid: 'di', name: 'Di', minute: 40),
            msg('plain', uid: 'ben', name: _longName, minute: 41),
          ],
          meUid: 'me',
          usersById: const {},
          emojiByName: const {},
          canDeleteAny: false,
          emptyTitle: 'Nothing here',
          emptyDesc: 'Say something',
          onOpenThread: (_) {},
          newSince: DateTime(2026, 11, 19, 10, 20).millisecondsSinceEpoch,
        ),
      ),
    );
  });

  scene(
    'the thread screen: a long message, replies without their quote, "Show in chat", the box',
    (tester, s) async {
      final replies = StreamController<List<ChatMessage>>();
      addTearDown(replies.close);
      final root = msg(
        'a',
        text:
            'the question, which is long enough to wrap a few times on a small phone',
      );
      await show(
        tester,
        s,
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ThreadScreen(
                      path: _path,
                      opened: root,
                      onShowInChat: (_) {},
                    ),
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
        overrides: [
          authStateProvider.overrideWith(
            (ref) => Stream<fb_auth.User?>.value(null),
          ),
          profileProvider.overrideWith((ref) => Stream.value(_me)),
          usersByIdProvider.overrideWithValue(const {}),
          activeUsersProvider.overrideWithValue(const []),
          emojiByNameProvider.overrideWithValue(const {}),
          messagesRepositoryProvider.overrideWithValue(_FakeRepo()),
          messagesProvider(
            _path,
          ).overrideWith((ref) => const Stream<MessagePage>.empty()),
          repliesProvider((
            path: _path,
            rootId: 'a',
          )).overrideWith((ref) => replies.stream),
        ],
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      replies.add([
        for (var i = 0; i < 6; i++)
          msg('r$i', to: 'a', uid: 'cy', name: _longName, minute: i + 1),
      ]);
      await tester.pumpAndSettle();
    },
  );

  scene(
    'the box with a reply bar, ten pictures, an error, a progress line and the format row open',
    (tester, s) async {
      final files = [
        for (var i = 0; i < 10; i++)
          Attachment(
            bytes: Uint8List.fromList(_png),
            name: 'picture-number-$i-with-a-long-name.png',
          ),
      ];
      await show(
        tester,
        s,
        Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: Composer(
              placeholder: 'Message #a-channel-with-a-long-name',
              onSend:
                  ({
                    required text,
                    imageBytes,
                    imageName,
                    remoteImageUrl,
                    remoteImageMeta,
                  }) async {
                    throw StateError(
                      'Sent 3 of 10. Couldn\'t reach the server, so you couldn\'t send that message. Check your connection and try again. (unavailable)',
                    );
                  },
              users: const [],
              replyingTo: msg(
                'r',
                text:
                    'what is being replied to, at some length, so the bar has to cope',
              ),
              onCancelReply: () {},
              pickImages: () async => files,
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('Formatting'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Add pictures'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField),
        'some words to send\nand a second line of them',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      // A long message must not take over the screen: the field stops growing and scrolls inside itself.
      await tester.enterText(
        find.byType(TextField),
        List.generate(20, (i) => 'line $i').join(String.fromCharCode(10)),
      );
      await tester.pumpAndSettle();
      expect(
        tester.getSize(find.byType(TextField)).height,
        lessThanOrEqualTo(s.h * 0.4),
      );
    },
  );

  scene('the format row alone', (tester, s) async {
    await show(
      tester,
      s,
      Scaffold(
        body: Align(
          alignment: Alignment.bottomCenter,
          child: FormatBar(onFormat: (_) {}),
        ),
      ),
    );
  });

  scene(
    'the search sheet with filters, a note about a bad piece, and results with long names',
    (tester, s) async {
      await show(
        tester,
        s,
        Builder(
          builder: (context) => Scaffold(
            body: ElevatedButton(
              onPressed: () => showSearchSheet(
                context,
                messages: [
                  for (var i = 0; i < 4; i++)
                    msg(
                      's$i',
                      text: i == 0
                          ? 'a match that is the very last one in the list'
                          : 'a match with some words around it, long enough to wrap on a small phone',
                      minute: i,
                    ),
                ],
                usersById: const {},
                onJump: (_) {},
              ),
              child: const Text('search'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('search'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField),
        'match has:nope before:2026-13-45',
      );
      await tester.pumpAndSettle();
      // The notes and the count are still there (they sit in the list now, so they can scroll).
      expect(
        find.textContaining('is not something to look for'),
        findsOneWidget,
      );
      expect(find.textContaining('is not a day'), findsOneWidget);
      await reveal(tester, find.text('4 matches'));
      expect(find.text('4 matches'), findsOneWidget);
      // ...and every result is still reachable below them.
      await reveal(tester, find.textContaining('the very last one'));
      expect(find.textContaining('the very last one'), findsOneWidget);
    },
  );

  scene('a spoiler, a long one, code and a mention in one message', (
    tester,
    s,
  ) async {
    await show(
      tester,
      s,
      Scaffold(
        body: SingleChildScrollView(
          child: MessageRenderer(
            text:
                'ending: ||${List.filled(40, 'secret').join(' ')}|| and `code` and **bold ||inner||** and ||**rich** <@abcdef12>||',
            emojiByName: const {},
            usersById: {
              'abcdef12': UserProfile(
                id: 'abcdef12',
                email: 'a@x.test',
                name: _longName,
                role: Role.employee,
              ),
            },
          ),
        ),
      ),
    );
  });
}
