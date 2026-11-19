import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
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
import 'package:punx_messenger/utils/saved.dart';
import 'package:punx_messenger/widgets/chat/message_list.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';
import 'package:punx_messenger/widgets/chat/thread_screen.dart';

ChatMessage _msg(
  String id, {
  String? to,
  int? ms,
  String text = '',
  String uid = 'ana',
  String? imageURL,
}) => ChatMessage(
  id: id,
  author: MessageAuthor(uid: uid, name: uid == 'me' ? 'Me' : 'Ana'),
  text: text.isEmpty && imageURL == null ? 'text $id' : text,
  imageURL: imageURL,
  replyTo: to == null
      ? null
      : ReplySnapshot(messageId: to, authorName: 'Ana', snippet: 'quoted'),
  createdAt: ms == null ? null : Timestamp.fromMillisecondsSinceEpoch(ms),
);

class _Sent {
  _Sent(this.path, this.text, this.replyTo, this.imageName);
  final String path;
  final String text;
  final ChatMessage? replyTo;
  final String? imageName;
}

class _FakeRepo implements MessagesRepository {
  final sent = <_Sent>[];
  Object? failWith;

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
  }) async {
    if (failWith != null) throw failWith!;
    sent.add(_Sent(path, text, replyTo, imageName));
  }

  /// Sending says "not typing any more"; nothing to record about it here.
  @override
  Future<void> setTyping(String containerPath, String uid, bool isTyping) async {}

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

/// Which single option pumpPicture gives its row.
var _only = '';

/// A real 1x1 picture, so a row with one decodes it rather than showing the broken-image box.
const _tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

  group('a message row', () {
    Future<List<ChatMessage>> pumpRow(
      WidgetTester tester, {
      ChatMessage? message,
      int replyCount = 0,
      bool withThread = true,
      bool withReply = false,
      bool withDelete = false,
      bool quote = true,
      int newReplies = 0,
      String meUid = 'me',
    }) async {
      phone(tester);
      final opened = <ChatMessage>[];
      await tester.pumpWidget(
        ProviderScope(
          overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
          child: MaterialApp(
            home: Scaffold(
              body: MessageRow(
                message: message ?? _msg('m1', text: 'hello there'),
                showHeader: true,
                meUid: meUid,
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
                replyCount: replyCount,
                onOpenThread: withThread ? opened.add : null,
                onReply: withReply ? (_) {} : null,
                onDelete: withDelete ? (_) {} : null,
                onEdit: withDelete ? (_, _) {} : null,
                showReplyQuote: quote,
                newReplyCount: newReplies,
              ),
            ),
          ),
        ),
      );
      return opened;
    }

    Future<void> longPress(WidgetTester tester) async {
      await tester.longPress(find.text('hello there', findRichText: true));
      await tester.pumpAndSettle();
    }

    testWidgets('says how many replies it has, in words, and opens its thread when pressed', (tester) async {
      final opened = await pumpRow(tester, replyCount: 2);
      expect(find.text('2 replies'), findsOneWidget);
      await tester.tap(find.text('2 replies'));
      await tester.pumpAndSettle();
      expect(opened.map((m) => m.id), ['m1']);
    });

    testWidgets('a reply shows what it quotes, unless told not to', (tester) async {
      await pumpRow(tester, message: _msg('r', to: 'a', text: 'hello there'));
      expect(find.textContaining('@Ana', findRichText: true), findsOneWidget);
      expect(find.textContaining('quoted', findRichText: true), findsOneWidget);
      await pumpRow(tester, message: _msg('r', to: 'a', text: 'hello there'), quote: false);
      expect(find.textContaining('@Ana', findRichText: true), findsNothing);
      expect(find.textContaining('quoted', findRichText: true), findsNothing);
      expect(find.text('hello there', findRichText: true), findsOneWidget, reason: 'the reply itself is still there');
    });

    testWidgets('turning the quote off changes nothing for a message that is not a reply', (tester) async {
      await pumpRow(tester, quote: false);
      expect(find.text('hello there', findRichText: true), findsOneWidget);
      expect(find.textContaining('@Ana', findRichText: true), findsNothing);
    });

    testWidgets('says how many of its replies are new, in a pill beside the count', (tester) async {
      final semantics = tester.ensureSemantics();
      await pumpRow(tester, replyCount: 3, newReplies: 2);
      expect(find.text('3 replies'), findsOneWidget);
      expect(find.text('2 new'), findsOneWidget);
      expect(find.bySemanticsLabel('3 replies, 2 new, open the thread'), findsOneWidget);
      final node = tester.getSemantics(find.bySemanticsLabel('3 replies, 2 new, open the thread'));
      expect(node.getSemanticsData().flagsCollection.isButton, isTrue, reason: 'offered as a button of its own');
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
      semantics.dispose();
    });

    testWidgets('with none new there is no pill, and the label is as before', (tester) async {
      final semantics = tester.ensureSemantics();
      await pumpRow(tester, replyCount: 3);
      expect(find.textContaining('new'), findsNothing);
      expect(find.bySemanticsLabel('3 replies, open the thread'), findsOneWidget);
      semantics.dispose();
    });

    testWidgets('the pill belongs to the count: without replies or without a way to open them there is none', (tester) async {
      await pumpRow(tester, replyCount: 0, newReplies: 2);
      expect(find.textContaining('new'), findsNothing);
      await pumpRow(tester, replyCount: 3, newReplies: 2, withThread: false);
      expect(find.textContaining('new'), findsNothing);
    });

    testWidgets('pressing the pill opens the thread, like the rest of the count', (tester) async {
      final opened = await pumpRow(tester, replyCount: 3, newReplies: 1);
      await tester.tap(find.text('1 new'));
      await tester.pumpAndSettle();
      expect(opened.map((m) => m.id), ['m1']);
    });

    testWidgets('one reply is "1 reply"', (tester) async {
      await pumpRow(tester, replyCount: 1);
      expect(find.text('1 reply'), findsOneWidget);
    });

    testWidgets('with no replies there is nothing under it', (tester) async {
      await pumpRow(tester);
      expect(find.textContaining('repl'), findsNothing);
    });

    testWidgets('where threads are not offered there is no count either, whatever the number', (tester) async {
      await pumpRow(tester, replyCount: 3, withThread: false);
      expect(find.textContaining('repl'), findsNothing);
    });

    testWidgets('the press target is at least 40 tall', (tester) async {
      await pumpRow(tester, replyCount: 2);
      expect(tester.getSize(find.ancestor(of: find.text('2 replies'), matching: find.byType(InkWell)).first).height, greaterThanOrEqualTo(40));
    });

    testWidgets('long-press offers "Start a thread" on a message with none, and it opens the thread', (tester) async {
      final opened = await pumpRow(tester);
      await longPress(tester);
      expect(find.text('Start a thread'), findsOneWidget);
      expect(find.text('Open thread'), findsNothing);
      await tester.tap(find.text('Start a thread'));
      await tester.pumpAndSettle();
      expect(opened.map((m) => m.id), ['m1']);
      expect(find.text('Start a thread'), findsNothing, reason: 'the menu closed');
    });

    testWidgets('long-press offers "Open thread" on a message that has replies', (tester) async {
      final opened = await pumpRow(tester, replyCount: 4);
      await longPress(tester);
      expect(find.text('Open thread'), findsOneWidget);
      expect(find.text('Start a thread'), findsNothing);
      await tester.tap(find.text('Open thread'));
      await tester.pumpAndSettle();
      expect(opened.map((m) => m.id), ['m1']);
    });

    testWidgets('no thread action where threads are not offered', (tester) async {
      await pumpRow(tester, withThread: false, withReply: true);
      await longPress(tester);
      expect(find.text('Copy text'), findsOneWidget, reason: 'the menu did open');
      expect(find.text('Start a thread'), findsNothing);
      expect(find.text('Open thread'), findsNothing);
    });

    testWidgets('Reply, Edit and Delete are offered only to a row that can do them', (tester) async {
      await pumpRow(tester, message: _msg('m1', text: 'hello there', uid: 'me'));
      await longPress(tester);
      expect(find.text('Copy text'), findsOneWidget, reason: 'the menu did open');
      expect(find.text('Reply'), findsNothing);
      expect(find.text('Edit'), findsNothing, reason: 'yours, but this row was given no way to edit');
      expect(find.text('Delete'), findsNothing, reason: 'yours, but this row was given no way to delete');
    });

    testWidgets('given the handlers, they are all there', (tester) async {
      await pumpRow(tester, message: _msg('m1', text: 'hello there', uid: 'me'), withReply: true, withDelete: true);
      await longPress(tester);
      expect(find.text('Reply'), findsOneWidget);
      expect(find.text('Edit'), findsOneWidget);
      expect(find.text('Delete'), findsOneWidget);
    });

    testWidgets("someone else's message is not offered Edit or Delete", (tester) async {
      await pumpRow(tester, withReply: true, withDelete: true);
      await longPress(tester);
      expect(find.text('Reply'), findsOneWidget, reason: 'the menu did open');
      expect(find.text('Edit'), findsNothing);
      expect(find.text('Delete'), findsNothing);
    });

    /// A picture with no words (so nothing to copy), given only the option named by [_only].
    Future<void> pumpPicture(WidgetTester tester, {String uid = 'ana', bool canPin = false}) async {
      phone(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
          child: MaterialApp(
            home: Scaffold(
              body: MessageRow(
                message: _msg('p1', imageURL: _tinyPng, uid: uid),
                showHeader: true,
                meUid: 'me',
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
                canPin: canPin,
                onReply: _only == 'reply' ? (_) {} : null,
                onReact: _only == 'react' ? (_, _) {} : null,
                onOpenThread: _only == 'thread' ? (_) {} : null,
                onForward: _only == 'forward' ? (_) {} : null,
                onSave: _only == 'save' ? (_) async => SaveResult.saved : null,
                onTogglePin: _only == 'pin' ? (_) {} : null,
                onDelete: _only == 'delete' ? (_) {} : null,
              ),
            ),
          ),
        ),
      );
      await tester.longPress(find.text(uid == 'me' ? 'Me' : 'Ana'));
      await tester.pumpAndSettle();
    }

    testWidgets('a row with nothing to offer opens no empty sheet', (tester) async {
      _only = '';
      await pumpPicture(tester);
      expect(find.byType(BottomSheet), findsNothing);
    });

    for (final c in <({String only, String title, String uid, bool pin})>[
      (only: 'reply', title: 'Reply', uid: 'ana', pin: false),
      (only: 'react', title: 'React', uid: 'ana', pin: false),
      (only: 'thread', title: 'Start a thread', uid: 'ana', pin: false),
      (only: 'forward', title: 'Forward', uid: 'ana', pin: false),
      (only: 'save', title: 'Save to My Notes', uid: 'ana', pin: false),
      (only: 'pin', title: 'Pin', uid: 'ana', pin: true),
      (only: 'delete', title: 'Delete', uid: 'me', pin: false),
    ]) {
      testWidgets('a picture with only "${c.title}" to offer still opens the sheet, with it', (tester) async {
        _only = c.only;
        await pumpPicture(tester, uid: c.uid, canPin: c.pin);
        expect(find.byType(BottomSheet), findsOneWidget);
        expect(find.text(c.title), findsOneWidget);
        expect(find.byType(ListTile), findsOneWidget, reason: 'and nothing else');
      });
    }

    testWidgets('pin is not offered without a way to pin, even where pinning is allowed', (tester) async {
      _only = 'reply';
      await pumpPicture(tester, canPin: true);
      expect(find.text('Reply'), findsOneWidget);
      expect(find.text('Pin'), findsNothing);
    });
  });

  group('the list of messages', () {
    Future<List<ChatMessage>> pumpList(WidgetTester tester, {bool threads = true}) async {
      phone(tester);
      final opened = <ChatMessage>[];
      await tester.pumpWidget(
        ProviderScope(
          overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
          child: MaterialApp(
            home: Scaffold(
              body: MessageListView(
                messages: [
                  _msg('a', ms: 1000, text: 'the question'),
                  _msg('b', ms: 2000, text: 'something else', uid: 'bo'),
                  _msg('r1', to: 'a', ms: 3000, text: 'first answer', uid: 'cy'),
                  _msg('r2', to: 'a', ms: 4000, text: 'second answer', uid: 'di'),
                  _msg('r3', to: 'b', ms: 5000, text: 'an answer to b', uid: 'ed'),
                ],
                meUid: 'me',
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
                emptyTitle: 'Nothing here',
                emptyDesc: 'Say something',
                onOpenThread: threads ? opened.add : null,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return opened;
    }

    Finder rowOf(String text) =>
        find.ancestor(of: find.text(text, findRichText: true), matching: find.byType(MessageRow));

    testWidgets('each message shows how many replies IT has: 2 under the question, 1 under b, none under the replies', (tester) async {
      await pumpList(tester);
      expect(find.descendant(of: rowOf('the question'), matching: find.text('2 replies')), findsOneWidget);
      expect(find.descendant(of: rowOf('something else'), matching: find.text('1 reply')), findsOneWidget);
      for (final other in ['first answer', 'second answer', 'an answer to b']) {
        expect(rowOf(other), findsOneWidget, reason: other);
        expect(find.descendant(of: rowOf(other), matching: find.textContaining('repl')), findsNothing, reason: other);
      }
    });

    testWidgets('pressing the count opens the thread of THAT message', (tester) async {
      final opened = await pumpList(tester);
      await tester.tap(find.text('1 reply'));
      await tester.pumpAndSettle();
      expect(opened.map((m) => m.id), ['b']);
      await tester.tap(find.text('2 replies'));
      await tester.pumpAndSettle();
      expect(opened.map((m) => m.id), ['b', 'a']);
    });

    testWidgets('in the conversation a reply still shows its quote', (tester) async {
      await pumpList(tester);
      expect(find.textContaining('@Ana', findRichText: true), findsNWidgets(3), reason: 'r1, r2 and r3 each quote their message');
    });

    testWidgets('without a way to open threads there is no count', (tester) async {
      await pumpList(tester, threads: false);
      expect(find.textContaining(RegExp(r'\d replies?')), findsNothing);
    });

    testWidgets('a reply that arrives updates the count, and one that goes away updates it again', (tester) async {
      phone(tester);
      Widget list(List<ChatMessage> messages) => ProviderScope(
        overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
        child: MaterialApp(
          home: Scaffold(
            body: MessageListView(
              messages: messages,
              meUid: 'me',
              usersById: const {},
              emojiByName: const {},
              canDeleteAny: false,
              emptyTitle: 'Nothing here',
              emptyDesc: 'Say something',
              onOpenThread: (_) {},
            ),
          ),
        ),
      );
      final q = _msg('a', ms: 1000, text: 'the question');
      final r1 = _msg('r1', to: 'a', ms: 2000, uid: 'cy');
      final r2 = _msg('r2', to: 'a', ms: 3000, uid: 'di');
      await tester.pumpWidget(list([q, r1]));
      await tester.pumpAndSettle();
      expect(find.text('1 reply'), findsOneWidget);
      await tester.pumpWidget(list([q, r1, r2]));
      await tester.pumpAndSettle();
      expect(find.text('2 replies'), findsOneWidget);
      expect(find.text('1 reply'), findsNothing);
      await tester.pumpWidget(list([q]));
      await tester.pumpAndSettle();
      expect(find.textContaining(RegExp(r'\d replies?')), findsNothing);
    });
  });

  group('the thread screen', () {
    // The conversation's loaded messages, and the thread's replies, are both streams the test can feed.
    late StreamController<MessagePage> convo;
    late StreamController<List<ChatMessage>> replies;
    late _FakeRepo repo;
    late ProviderContainer container;
    var opened = <String>[];
    var seenCalls = <({String root, List<String> replies})>[];

    Future<void> pump(
      WidgetTester tester, {
      ChatMessage? root,
      List<ChatMessage>? loaded,
      List<ChatMessage>? first,
      bool withShow = true,
    }) async {
      phone(tester);
      convo = StreamController<MessagePage>();
      replies = StreamController<List<ChatMessage>>();
      addTearDown(convo.close);
      addTearDown(replies.close);
      repo = _FakeRepo();
      opened = [];
      seenCalls = [];
      final r = root ?? _msg('a', ms: 1000, text: 'the question', uid: 'ana');
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            statusOfProvider.overrideWith((ref, uid) => 'online'),
            authStateProvider.overrideWith((ref) => Stream<fb_auth.User?>.value(null)),
            profileProvider.overrideWith((ref) => Stream.value(_me)),
            usersByIdProvider.overrideWithValue(const {}),
            activeUsersProvider.overrideWithValue(const []),
            emojiByNameProvider.overrideWithValue(const {}),
            messagesRepositoryProvider.overrideWithValue(repo),
            messagesProvider(_path).overrideWith((ref) => convo.stream),
            repliesProvider((path: _path, rootId: r.id)).overrideWith((ref) => replies.stream),
          ],
          child: MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: ElevatedButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ThreadScreen(
                          path: _path,
                          opened: r,
                          onShowInChat: withShow ? opened.add : null,
                          onSeen: (id, replies) => seenCalls.add((root: id, replies: replies.map((m) => m.id).toList())),
                        ),
                      ),
                    ),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      container = ProviderScope.containerOf(tester.element(find.byType(ElevatedButton)));
      // In the app the profile is always being watched by something; here, nothing else does.
      final keep = container.listen(profileProvider, (_, _) {});
      addTearDown(keep.close);
      await tester.pump();
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      if (loaded != null) convo.add(MessagePage(loaded, hasMore: false));
      if (first != null) replies.add(first);
      await tester.pumpAndSettle();
    }

    List<String> shownReplies(WidgetTester tester) => tester
        .widgetList<MessageRow>(find.byType(MessageRow))
        .map((r) => r.message.id)
        .toList();

    testWidgets('shows the message, then how many replies, then the replies oldest first', (tester) async {
      await pump(tester, first: [
        _msg('r2', to: 'a', ms: 3000, text: 'second', uid: 'bo'),
        _msg('r1', to: 'a', ms: 2000, text: 'first', uid: 'cy'),
      ]);
      expect(find.text('Thread'), findsOneWidget);
      expect(shownReplies(tester), ['a', 'r1', 'r2'], reason: 'the message, then its replies in time order');
      expect(find.text('2 replies'), findsOneWidget);
      expect(find.text('Write the first reply below.'), findsNothing);
    });

    testWidgets('says so while the first answer is on its way, and when there are none', (tester) async {
      await pump(tester);
      expect(find.text('Loading…'), findsOneWidget);
      expect(find.text('No replies yet'), findsNothing);
      replies.add(const []);
      await tester.pumpAndSettle();
      expect(find.text('Loading…'), findsNothing);
      expect(find.text('No replies yet'), findsOneWidget);
      expect(find.text('Write the first reply below.'), findsOneWidget);
    });

    testWidgets('keeps only the replies to THIS message, whatever the query hands over', (tester) async {
      await pump(tester, first: [
        _msg('mine', to: 'a', ms: 2000),
        _msg('other', to: 'b', ms: 2500),
        _msg('plain', ms: 2600),
        _msg('self', to: 'self', ms: 2700),
      ]);
      expect(shownReplies(tester), ['a', 'mine']);
      expect(find.text('1 reply'), findsOneWidget);
    });

    testWidgets('a reply arriving later appears, and the count follows', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a', ms: 2000)]);
      expect(find.text('1 reply'), findsOneWidget);
      replies.add([_msg('r1', to: 'a', ms: 2000), _msg('r2', to: 'a', ms: 3000)]);
      await tester.pumpAndSettle();
      expect(find.text('2 replies'), findsOneWidget);
      expect(shownReplies(tester), ['a', 'r1', 'r2']);
    });

    testWidgets('a failed read is said, in words, instead of "No replies yet"', (tester) async {
      await pump(tester);
      replies.addError(FirebaseException(plugin: 'cloud_firestore', code: 'permission-denied'));
      await tester.pumpAndSettle();
      expect(find.textContaining("You don't have permission to load the replies"), findsOneWidget);
      expect(find.text('No replies yet'), findsNothing);
      expect(find.text('Write the first reply below.'), findsNothing);
      expect(find.text('Loading…'), findsNothing);
    });

    testWidgets('the message is shown as it is now when the conversation has it, as it was opened when not', (tester) async {
      await pump(tester, first: const [], loaded: [_msg('a', ms: 1000, text: 'the question, edited')]);
      expect(find.text('the question, edited', findRichText: true), findsOneWidget);
      expect(find.text('the question', findRichText: true), findsNothing);
    });

    testWidgets('the message as it was opened is used while the conversation is not loaded', (tester) async {
      await pump(tester, first: const []);
      expect(find.text('the question', findRichText: true), findsOneWidget);
    });

    testWidgets('a reply written here goes to the conversation, quoting the message', (tester) async {
      await pump(tester, first: const []);
      await tester.enterText(find.byType(TextField), 'my answer');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(repo.sent, hasLength(1));
      final s = repo.sent.single;
      expect(s.path, _path);
      expect(s.text, 'my answer');
      expect(s.replyTo?.id, 'a', reason: 'it quotes the message the thread is about');
    });

    testWidgets('the box says what it is for, and a failure to send is said and keeps the text', (tester) async {
      await pump(tester, first: const []);
      expect(find.text('Reply in thread'), findsOneWidget);
      repo.failWith = FirebaseException(plugin: 'cloud_firestore', code: 'unavailable');
      await tester.enterText(find.byType(TextField), 'my answer');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(repo.sent, isEmpty);
      expect(find.textContaining("you couldn't send that message"), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'my answer');
    });

    testWidgets("what is being replied to in the conversation is left alone by a thread reply", (tester) async {
      await pump(tester, first: const []);
      final controller = container.read(chatControllerProvider(_path).notifier);
      final other = _msg('z', ms: 9000, text: 'something else');
      controller.setReplyingTo(other);
      await tester.enterText(find.byType(TextField), 'my answer');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(repo.sent.single.replyTo?.id, 'a', reason: 'the thread, not the conversation\'s reply');
      expect(container.read(chatControllerProvider(_path)).replyingTo?.id, 'z', reason: 'still being written there');
    });

    testWidgets('a plain send in the conversation still quotes what is being replied to, and clears it', (tester) async {
      await pump(tester, first: const []);
      final controller = container.read(chatControllerProvider(_path).notifier);
      controller.setReplyingTo(_msg('z', ms: 9000, text: 'something else'));
      await controller.send(text: 'hi');
      expect(repo.sent.single.replyTo?.id, 'z');
      expect(container.read(chatControllerProvider(_path)).replyingTo, isNull);
      // Several pictures go as several messages: only the first quotes.
      await controller.send(text: 'and another');
      expect(repo.sent, hasLength(2));
      expect(repo.sent.last.replyTo, isNull, reason: 'the quote went with the first message only');
    });

    testWidgets('"Show in chat" is under each reply, not the message, and takes you back there', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a', ms: 2000), _msg('r2', to: 'a', ms: 3000)]);
      expect(find.text('Show in chat'), findsNWidgets(2));
      await tester.tap(find.text('Show in chat').last);
      await tester.pumpAndSettle();
      expect(opened, ['r2']);
      expect(find.text('Thread'), findsNothing, reason: 'the screen closed');
      expect(find.text('open'), findsOneWidget);
    });

    testWidgets('no "Show in chat" when nowhere to go', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a', ms: 2000)], withShow: false);
      expect(find.text('Show in chat'), findsNothing);
    });

    testWidgets('the replies are read-only: no reply, edit or delete on a long-press', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a', ms: 2000, text: 'first', uid: 'me')]);
      await tester.longPress(find.text('first', findRichText: true));
      await tester.pumpAndSettle();
      expect(find.text('Copy text'), findsOneWidget, reason: 'the menu did open');
      expect(find.text('Reply'), findsNothing);
      expect(find.text('Edit'), findsNothing);
      expect(find.text('Delete'), findsNothing);
      expect(find.text('Start a thread'), findsNothing, reason: 'a thread is flat');
    });

    testWidgets('it tells the conversation which replies it is showing, once they are in', (tester) async {
      await pump(tester);
      expect(seenCalls, isEmpty, reason: 'nothing to show yet');
      replies.add([_msg('r2', to: 'a', ms: 3000), _msg('r1', to: 'a', ms: 2000)]);
      await tester.pumpAndSettle();
      expect(seenCalls, hasLength(1));
      expect(seenCalls.single.root, 'a');
      expect(seenCalls.single.replies.toSet(), {'r1', 'r2'});
    });

    testWidgets('and again when another reply arrives, but not when nothing changed', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a', ms: 2000)]);
      expect(seenCalls, hasLength(1));
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(seenCalls, hasLength(1), reason: 'a rebuild is not a change');
      replies.add([_msg('r1', to: 'a', ms: 2000), _msg('r2', to: 'a', ms: 3000)]);
      await tester.pumpAndSettle();
      expect(seenCalls, hasLength(2));
      expect(seenCalls.last.replies.toSet(), {'r1', 'r2'});
    });

    testWidgets('a reply going away does not tell it again', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a', ms: 2000), _msg('r2', to: 'a', ms: 3000)]);
      expect(seenCalls, hasLength(1));
      replies.add([_msg('r1', to: 'a', ms: 2000)]);
      await tester.pumpAndSettle();
      expect(seenCalls, hasLength(1), reason: 'a thread is never unseen again');
    });

    testWidgets('replies not sent yet (no time) are not reported on their own', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a')]);
      expect(seenCalls, isEmpty);
    });

    testWidgets('only after the frame: telling the conversation mid-build would rebuild it mid-build', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a', ms: 2000)]);
      expect(tester.takeException(), isNull);
      expect(seenCalls, hasLength(1));
    });

    testWidgets('the replies do not repeat the quote of the message above them', (tester) async {
      await pump(tester, first: [_msg('r1', to: 'a', ms: 2000, text: 'first'), _msg('r2', to: 'a', ms: 3000, text: 'second')]);
      expect(find.text('first', findRichText: true), findsOneWidget);
      expect(find.text('second', findRichText: true), findsOneWidget);
      expect(find.textContaining('@Ana', findRichText: true), findsNothing);
      expect(find.textContaining('quoted', findRichText: true), findsNothing);
    });

    testWidgets('the message at the top keeps its own quote when it is itself a reply', (tester) async {
      await pump(
        tester,
        root: _msg('a', to: 'z', ms: 1000, text: 'the question'),
        first: [_msg('r1', to: 'a', ms: 2000, text: 'first')],
      );
      expect(find.textContaining('@Ana', findRichText: true), findsOneWidget, reason: 'one quote, the top message\'s, not the reply\'s');
    });

    testWidgets('a new reply scrolls the screen to the end', (tester) async {
      final many = [for (var i = 1; i <= 30; i++) _msg('r${i.toString().padLeft(2, '0')}', to: 'a', ms: 1000 + i, text: 'reply number $i')];
      await pump(tester, first: many);
      final list = find.byType(ListView);
      final before = tester.state<ScrollableState>(find.descendant(of: list, matching: find.byType(Scrollable)).first);
      expect(before.position.maxScrollExtent, greaterThan(0), reason: 'long enough to scroll');
      expect(before.position.pixels, before.position.maxScrollExtent, reason: 'opened at the end');
      before.position.jumpTo(0);
      await tester.pump();
      replies.add([...many, _msg('r31', to: 'a', ms: 2000, text: 'the newest')]);
      await tester.pumpAndSettle();
      final after = tester.state<ScrollableState>(find.descendant(of: list, matching: find.byType(Scrollable)).first);
      expect(after.position.pixels, after.position.maxScrollExtent);
    });

    testWidgets('a reply going away does not move the screen', (tester) async {
      final many = [for (var i = 1; i <= 30; i++) _msg('r${i.toString().padLeft(2, '0')}', to: 'a', ms: 1000 + i, text: 'reply number $i')];
      await pump(tester, first: many);
      final s = tester.state<ScrollableState>(find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)).first);
      s.position.jumpTo(0);
      await tester.pump();
      replies.add(many.sublist(1));
      await tester.pumpAndSettle();
      expect(s.position.pixels, 0);
    });
  });

  group('the list, with what is new in a thread', () {
    // The question (a) is at 10:00; Ben (cy) answered at 10:05, Ana at 10:40, and I (me) at 10:50.
    int at(int h, int m) => DateTime(2026, 11, 19, h, m).millisecondsSinceEpoch;
    final messages = [
      _msg('a', ms: at(10, 0), text: 'the question', uid: 'ana'),
      _msg('r1', to: 'a', ms: at(10, 5), text: 'first answer', uid: 'cy'),
      _msg('r2', to: 'a', ms: at(10, 40), text: 'second answer', uid: 'ana'),
      _msg('r3', to: 'a', ms: at(10, 50), text: 'my answer', uid: 'me'),
      _msg('b', ms: at(10, 1), text: 'another question', uid: 'ana'),
      _msg('r4', to: 'b', ms: at(10, 52), text: 'answer to b', uid: 'cy'),
    ];

    Future<void> pumpNew(
      WidgetTester tester, {
      List<ChatMessage>? list,
      int? since,
      Map<String, int> seen = const {},
      bool threads = true,
    }) async {
      phone(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [statusOfProvider.overrideWith((ref, uid) => 'online')],
          child: MaterialApp(
            home: Scaffold(
              body: MessageListView(
                messages: list ?? messages,
                meUid: 'me',
                usersById: const {},
                emojiByName: const {},
                canDeleteAny: false,
                emptyTitle: 'Nothing here',
                emptyDesc: 'Say something',
                onOpenThread: threads ? (_) {} : null,
                newSince: since,
                threadSeen: seen,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    Finder rowOf(String text) =>
        find.ancestor(of: find.text(text, findRichText: true), matching: find.byType(MessageRow));

    testWidgets('each message shows how many replies are new for IT: only from others, only after you last read', (tester) async {
      await pumpNew(tester, since: at(10, 20));
      // a: r2 (Ana, 10:40) is new; r1 was before; r3 is mine. b: r4 (cy, 10:52) is new.
      expect(find.descendant(of: rowOf('the question'), matching: find.text('1 new')), findsOneWidget);
      expect(find.descendant(of: rowOf('another question'), matching: find.text('1 new')), findsOneWidget);
      expect(find.text('3 replies'), findsOneWidget, reason: 'a has three replies, new or not');
    });

    testWidgets('an earlier last-read time makes more of them new', (tester) async {
      await pumpNew(tester, since: at(10, 0));
      expect(find.descendant(of: rowOf('the question'), matching: find.text('2 new')), findsOneWidget, reason: 'r1 and r2; not mine');
    });

    testWidgets('a thread that has been looked at shows nothing new, up to what was seen', (tester) async {
      await pumpNew(tester, since: at(10, 0), seen: {'a': at(10, 5)});
      expect(find.descendant(of: rowOf('the question'), matching: find.text('1 new')), findsOneWidget, reason: 'r2 only');
      await pumpNew(tester, since: at(10, 0), seen: {'a': at(10, 40), 'b': at(10, 52)});
      expect(find.textContaining('new'), findsNothing);
    });

    testWidgets('without a last-read time, nothing is new', (tester) async {
      await pumpNew(tester);
      expect(find.text('3 replies'), findsOneWidget, reason: 'the replies are still counted');
      expect(find.textContaining(' new'), findsNothing);
    });

    testWidgets('without a way to open threads there is no count and no pill', (tester) async {
      await pumpNew(tester, since: at(10, 0), threads: false);
      expect(find.textContaining('repl'), findsNothing);
      expect(find.textContaining(' new'), findsNothing);
    });

    testWidgets('it follows a thread being looked at, and a reply arriving', (tester) async {
      await pumpNew(tester, since: at(10, 0));
      expect(find.text('2 new'), findsOneWidget);
      await pumpNew(tester, since: at(10, 0), seen: {'a': at(10, 40), 'b': at(10, 52)});
      expect(find.textContaining(' new'), findsNothing);
      final later = [...messages, _msg('r5', to: 'a', ms: at(11, 0), text: 'late answer', uid: 'cy')];
      await pumpNew(tester, list: later, since: at(10, 0), seen: {'a': at(10, 40), 'b': at(10, 52)});
      expect(find.text('1 new'), findsOneWidget, reason: 'the late answer is new again');
      expect(find.text('4 replies'), findsOneWidget);
    });

    testWidgets('it follows the last-read time changing', (tester) async {
      await pumpNew(tester, since: at(10, 0));
      expect(find.text('2 new'), findsOneWidget);
      await pumpNew(tester, since: at(10, 59));
      expect(find.textContaining(' new'), findsNothing);
    });
  });

  group('wiring (the chat screen and Firestore cannot run in a widget test)', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the chat takes the last-read time when it decides the "New" line, and starts clean when it is opened again', () {
      final s = read('lib/widgets/chat/chat_surface.dart');
      expect(
        s.contains(
          '        final lastRead = _readAtEntry.known\n'
          '            ? _readAtEntry.at\n'
          '            : me!.lastRead[pathToReadKey(containerPath)];\n'
          '        _newFromId = firstUnreadId(messages, lastRead, meUid);\n'
          '        _readSinceMs = lastRead?.millisecondsSinceEpoch;\n',
        ),
        isTrue,
        reason: 'the same moment as the "New" line',
      );
      expect(s.contains('    _newFromId = null;\n    _readSinceMs = null;\n    _threadSeen = const {};\n'), isTrue);
      expect(s.contains('                  newFromId: _newFromId,\n                  newSince: _readSinceMs,\n                  threadSeen: _threadSeen,\n'), isTrue);
    });

    test('a thread seen moves the map only when something moved, and only while the chat is there', () {
      final s = read('lib/widgets/chat/chat_surface.dart');
      expect(
        s.contains(
          '  void _markSeen(String rootId, List<ChatMessage> replies) {\n'
          '    if (!mounted) return;\n'
          '    final next = markThreadSeen(_threadSeen, rootId, replies);\n'
          '    if (identical(next, _threadSeen)) return;\n'
          '    setState(() => _threadSeen = next);\n'
          '  }',
        ),
        isTrue,
      );
      expect(s.contains('          onShowInChat: _jumpTo,\n          onSeen: _markSeen,\n'), isTrue);
    });

    test('the list works out what is new once per change of what it depends on', () {
      final s = read('lib/widgets/chat/message_list.dart');
      expect(s.contains('    if (!identical(_newCountedFor, widget.messages) ||\n        _newCountedSince != widget.newSince ||\n        !identical(_newCountedSeen, widget.threadSeen) ||\n        _newCountedMe != widget.meUid) {'), isTrue);
      expect(s.contains('    final newCounts = widget.onOpenThread == null\n        ? const <String, int>{}\n        : _newReplyCountsFor();'), isTrue);
      expect(s.contains('              newReplyCount: newCounts[entry.message.id] ?? 0,\n'), isTrue);
    });

    test('the thread screen tells the conversation after the frame, and once per change', () {
      final s = read('lib/widgets/chat/thread_screen.dart');
      expect(s.contains('    if (newest == null || (_reportedMs != null && newest <= _reportedMs!)) return;\n    _reportedMs = newest;\n    WidgetsBinding.instance.addPostFrameCallback((_) {\n      if (mounted) widget.onSeen?.call(rootId, replies);\n    });'), isTrue);
      expect(s.contains('    _followTo(replies.length);\n    _reportSeen(root.id, replies);\n'), isTrue);
    });

    test('the replies are their own query: equality on the quote\'s message id, no ordering, capped', () {
      final s = read('lib/services/messages_repository.dart');
      expect(
        s.contains(
          '  Stream<List<ChatMessage>> listenReplies(\n'
          '    String path,\n'
          '    String rootId, {\n'
          '    int limit = threadReplyLimit,\n'
          '  }) {\n'
          '    return _db\n'
          '        .collection(path)\n'
          "        .where('replyTo.messageId', isEqualTo: rootId)\n"
          '        .limit(limit)\n'
          '        .snapshots()\n'
          '        .map((snap) => snap.docs.map(ChatMessage.fromDoc).toList());',
        ),
        isTrue,
      );
      final i = s.indexOf('Stream<List<ChatMessage>> listenReplies(');
      final j = s.indexOf('Future<void> sendMessage(', i);
      expect(s.substring(i, j).contains('orderBy'), isFalse, reason: 'ordering would need an index that does not exist');
    });

    test('the provider asks for this path and this message', () {
      final s = read('lib/providers/messages_providers.dart');
      expect(
        s.contains(
          '    StreamProvider.family<List<ChatMessage>, ({String path, String rootId})>(\n'
          '      (ref, key) => ref\n'
          '          .watch(messagesRepositoryProvider)\n'
          '          .listenReplies(key.path, key.rootId),\n'
          '    );',
        ),
        isTrue,
      );
    });

    test('the controller sends a thread reply quoting that message and leaves the conversation\'s own reply alone', () {
      final s = read('lib/providers/messages_providers.dart');
      expect(s.contains('    ChatMessage? replyTo,\n  }) async {'), isTrue);
      expect(s.contains('      replyTo: replyTo ?? state.replyingTo,\n    );\n    if (replyTo == null) setReplyingTo(null);'), isTrue);
    });

    test('the thread screen sends through the controller of ITS conversation, quoting the open message', () {
      final s = read('lib/widgets/chat/thread_screen.dart');
      expect(s.contains('ref.read(chatControllerProvider(path).notifier)'), isTrue);
      expect(s.contains('                        replyTo: root,\n'), isTrue);
      expect(s.contains("repliesProvider((path: path, rootId: root.id))"), isTrue);
      expect(s.contains("draftKey: meUid == null ? null : '\$meUid:\$path#thread:\${root.id}',"), isTrue, reason: 'a draft per thread, apart from the conversation\'s');
      expect(s.contains('final root = currentRoot(messages, widget.opened);'), isTrue);
      expect(s.contains('                            row(m, quote: false),\n'), isTrue, reason: 'the replies are drawn without their quote');
      expect(s.contains('threadReplies(repliesAsync.valueOrNull ?? const [], root.id)'), isTrue);
    });

    test('the conversation offers threads only where they exist, and "Show in chat" scrolls to the message', () {
      final s = read('lib/widgets/chat/chat_surface.dart');
      expect(s.contains('                  onOpenThread: threadsAllowed(widget.path) ? _openThread : null,\n'), isTrue);
      expect(
        s.contains(
          '        builder: (_) => ThreadScreen(\n'
          '          path: widget.path,\n'
          '          opened: root,\n'
          '          onShowInChat: _jumpTo,\n'
          '          onSeen: _markSeen,\n'
          '        ),',
        ),
        isTrue,
      );
    });

    test('the list counts only when it can open a thread, and counts once per list of messages', () {
      final s = read('lib/widgets/chat/message_list.dart');
      expect(s.contains('    final counts = widget.onOpenThread == null\n        ? const <String, int>{}\n        : _replyCountsFor(widget.messages);'), isTrue);
      expect(s.contains('    if (!identical(_countedFor, messages)) {\n      _countedFor = messages;\n      _counts = replyCounts(messages);\n    }'), isTrue);
      expect(s.contains('              replyCount: counts[entry.message.id] ?? 0,\n              onOpenThread: widget.onOpenThread,'), isTrue);
    });

    test('threads are not offered in My Notes, the web\'s rule', () {
      // Same rule, same place: conversations only.
      final t = read('lib/utils/threads.dart');
      expect(t.contains("path != null && (path.startsWith('dms/') || path.startsWith('groups/'))"), isTrue);
    });
  });
}
