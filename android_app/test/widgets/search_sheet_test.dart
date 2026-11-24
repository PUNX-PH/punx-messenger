import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/models/reply_snapshot.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/models/voice_clip.dart';
import 'package:punx_messenger/widgets/chat/search_sheet.dart';

Timestamp day(int d, [int h = 12]) =>
    Timestamp.fromDate(DateTime(2026, 11, d, h));

UserProfile user(String id, String name) =>
    UserProfile(id: id, email: '$id@x.test', name: name, role: Role.employee);

final users = {
  'ana': user('ana', 'Ana Reyes'),
  'ben': user('ben', 'Ben Cruz'),
  'me': user('me', 'Rey'),
};

final voice = VoiceClip.fromFields('data:audio/webm;base64,AAAA', {'durationMs': 1000});

ChatMessage msg(
  String id,
  String uid,
  int d, {
  String text = '',
  String? imageURL,
  bool withVoice = false,
  String? replyTo,
  bool pinned = false,
  List<String> mentions = const [],
}) => ChatMessage(
  id: id,
  author: MessageAuthor(uid: uid, name: uid),
  text: text,
  imageURL: imageURL,
  voice: withVoice ? voice : null,
  replyTo: replyTo == null ? null : ReplySnapshot(messageId: replyTo, authorName: 'A', snippet: 's'),
  pinned: pinned,
  mentionedUids: mentions,
  createdAt: day(d),
);

final messages = [
  msg('1', 'ben', 2, text: 'Morning all. Standup is at 10:30.'),
  msg('2', 'ana', 3, text: 'Can someone review the release notes before 3pm?', pinned: true),
  msg('3', 'me', 3, text: 'Draft is here https://docs.example.com/release'),
  msg('4', 'ana', 4, imageURL: 'data:image/png;base64,AAAA'),
  msg('5', 'ben', 5, text: 'Typo in the second paragraph, fixed it.', replyTo: '2', mentions: ['ana']),
  msg('6', 'me', 6, text: 'Looks good to me. Ship the release.', replyTo: '2'),
  msg('7', 'ben', 6, withVoice: true),
];

String _textOf(Text t) => t.data ?? t.textSpan!.toPlainText();

/// The words of a result that are marked, as the sheet draws them.
List<String> _marked(WidgetTester tester, int index) {
  final text = tester.widgetList<ListTile>(find.byType(ListTile)).elementAt(index).subtitle as Text;
  final out = <String>[];
  text.textSpan!.visitChildren((span) {
    if (span is TextSpan && span.style?.backgroundColor != null) out.add(span.text!);
    return true;
  });
  return out;
}

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
    // A press that lands on nothing must fail the test, not pass it by doing nothing.
    WidgetController.hitTestWarningShouldBeFatal = true;
  });

  final jumped = <String>[];
  setUp(jumped.clear);

  Future<void> open(WidgetTester tester, {String? meUid = 'me', List<ChatMessage>? list}) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => showSearchSheet(
                  context,
                  messages: list ?? messages,
                  usersById: users,
                  meUid: meUid,
                  onJump: jumped.add,
                ),
                child: const Text('search'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('search'));
    await tester.pumpAndSettle();
  }

  Future<void> type(WidgetTester tester, String q) async {
    await tester.enterText(find.byType(TextField), q);
    await tester.pumpAndSettle();
  }

  /// The people in the results, in the order shown.
  List<String> shown(WidgetTester tester) =>
      tester.widgetList<ListTile>(find.byType(ListTile)).map((t) => _textOf(t.subtitle as Text)).toList();

  bool chipOn(WidgetTester tester, String label) =>
      tester.widget<FilterChip>(find.widgetWithText(FilterChip, label)).selected;

  Future<void> press(WidgetTester tester, String label) async {
    await tester.ensureVisible(find.widgetWithText(FilterChip, label));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilterChip, label));
    await tester.pumpAndSettle();
  }

  String boxText(WidgetTester tester) => tester.widget<TextField>(find.byType(TextField)).controller!.text;

  testWidgets('opens with the buttons, what to type, and nothing searched yet', (tester) async {
    await open(tester);
    for (final label in ['Pictures', 'Voice', 'Links', 'Replies', 'Pinned']) {
      expect(find.widgetWithText(FilterChip, label), findsOneWidget, reason: label);
    }
    expect(find.text('Type to search'), findsOneWidget);
    expect(find.textContaining('from:name'), findsOneWidget);
    expect(find.textContaining('has:image'), findsOneWidget);
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('the words searched for are marked in each result, whatever their capitals', (tester) async {
    await open(tester);
    await type(tester, 'RELEASE');
    expect(find.text('3 matches'), findsOneWidget);
    for (var i = 0; i < 3; i++) {
      expect(_marked(tester, i), ['release'], reason: 'result $i');
    }
    // the text is whole, and read out as it was (the marking is only a background)
    expect(shown(tester)[2], 'Can someone review the release notes before 3pm?');
  });

  testWidgets('accents and capitals do not matter, in what is found and in what is marked', (tester) async {
    await open(tester, list: [
      msg('a1', 'ana', 2, text: 'Un Café con leche'),
      msg('a2', 'ben', 3, text: 'otro CAFÉ, otro cafe'),
      msg('a3', 'me', 4, text: 'nothing here'),
    ]);
    await type(tester, 'cafe');
    expect(find.text('2 matches'), findsOneWidget);
    expect(_marked(tester, 0), ['CAFÉ', 'cafe']);
    expect(_marked(tester, 1), ['Café']);
    await type(tester, 'CAFÉ from:ANA');
    expect(find.text('1 match'), findsOneWidget);
    expect(_marked(tester, 0), ['Café']);
  });

  testWidgets('every match in a result is marked, and only the words, not the filters', (tester) async {
    await open(tester);
    await type(tester, 'e from:ben');
    expect(find.byType(ListTile), findsOneWidget);
    expect(_marked(tester, 0), ['e', 'e', 'e']); // the, second, fixed
  });

  testWidgets('a result found only through filters, or a picture, has nothing marked', (tester) async {
    await open(tester);
    await type(tester, 'has:link');
    expect(find.byType(ListTile), findsOneWidget);
    expect(_marked(tester, 0), isEmpty);
  });

  testWidgets('words alone still work, newest first', (tester) async {
    await open(tester);
    await type(tester, 'release');
    expect(find.text('3 matches'), findsOneWidget);
    expect(shown(tester), [
      'Looks good to me. Ship the release.',
      'Draft is here https://docs.example.com/release',
      'Can someone review the release notes before 3pm?',
    ]);
  });

  testWidgets('"from:me" is the person searching, and narrows the words', (tester) async {
    await open(tester);
    await type(tester, 'release from:me');
    expect(find.text('2 matches'), findsOneWidget);
    expect(shown(tester), ['Looks good to me. Ship the release.', 'Draft is here https://docs.example.com/release']);
    expect(find.text('Rey'), findsNWidgets(2), reason: 'both are from the live name of the person who is "me"');
  });

  testWidgets('from: by name, and two people at once', (tester) async {
    await open(tester);
    await type(tester, 'from:cruz');
    expect(find.text('3 matches'), findsOneWidget);
    await type(tester, 'from:cruz from:ana has:image');
    expect(find.text('1 match'), findsOneWidget);
  });

  testWidgets('without knowing who you are, "from:me" finds nothing', (tester) async {
    await open(tester, meUid: null);
    await type(tester, 'from:me');
    expect(find.text('0 matches'), findsOneWidget);
  });

  testWidgets('a button puts its filter in the box, and a second press takes it out', (tester) async {
    await open(tester);
    await press(tester, 'Pictures');
    expect(boxText(tester), 'has:image');
    expect(chipOn(tester, 'Pictures'), isTrue);
    expect(find.text('1 match'), findsOneWidget);
    expect(find.text('Picture'), findsOneWidget, reason: 'a picture with no words says what it is');
    await press(tester, 'Pictures');
    expect(boxText(tester), '');
    expect(chipOn(tester, 'Pictures'), isFalse);
    expect(find.text('Type to search'), findsOneWidget);
  });

  testWidgets('a button keeps what was already typed, and the box is where its filter lives', (tester) async {
    await open(tester);
    await type(tester, 'release');
    await press(tester, 'Links');
    expect(boxText(tester), 'release has:link');
    expect(find.text('1 match'), findsOneWidget);
    expect(chipOn(tester, 'Links'), isTrue);
    expect(chipOn(tester, 'Pictures'), isFalse);
  });

  testWidgets('typing a filter lights its button', (tester) async {
    await open(tester);
    await type(tester, 'has:voice');
    expect(chipOn(tester, 'Voice'), isTrue);
    expect(find.text('Voice message'), findsOneWidget, reason: 'a voice message with no words says what it is');
    expect(find.text('1 match'), findsOneWidget);
  });

  testWidgets('every button finds what it says', (tester) async {
    await open(tester);
    final expected = {'Pictures': 1, 'Voice': 1, 'Links': 1, 'Replies': 2, 'Pinned': 1};
    for (final e in expected.entries) {
      await press(tester, e.key);
      expect(find.text('${e.value} match${e.value == 1 ? '' : 'es'}'), findsOneWidget, reason: e.key);
      await press(tester, e.key);
    }
  });

  testWidgets('dates narrow it too: after, before, on', (tester) async {
    await open(tester);
    await type(tester, 'after:2026-11-04');
    expect(find.text('3 matches'), findsOneWidget, reason: '5th and 6th (two)');
    await type(tester, 'before:2026-11-03');
    expect(find.text('1 match'), findsOneWidget);
    await type(tester, 'on:2026-11-03');
    expect(find.text('2 matches'), findsOneWidget);
  });

  testWidgets('a piece that cannot be used is said in one line, and left out of the search', (tester) async {
    await open(tester);
    await type(tester, 'has:image before:2026-13-45');
    expect(find.textContaining('"before:2026-13-45" is not a day'), findsOneWidget);
    expect(find.text('1 match'), findsOneWidget, reason: 'the bad date is ignored, the picture filter is not');
  });

  testWidgets('only a bad piece is no search at all, but it is still explained', (tester) async {
    await open(tester);
    await type(tester, 'has:banana');
    expect(find.textContaining('"has:banana" is not something to look for'), findsOneWidget);
    expect(find.text('Type to search'), findsOneWidget);
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('no matches says so', (tester) async {
    await open(tester);
    await type(tester, 'zebra');
    expect(find.text('0 matches'), findsOneWidget);
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('pressing a result closes the sheet and jumps to that message', (tester) async {
    await open(tester);
    await type(tester, 'from:ben');
    await tester.tap(find.byType(ListTile).first);
    await tester.pumpAndSettle();
    expect(jumped, ['7'], reason: 'the newest first');
    expect(find.byType(TextField), findsNothing, reason: 'the sheet closed');
  });

  testWidgets('a result that is a reply is found by has:reply, and mentions: finds who was mentioned', (tester) async {
    await open(tester);
    await type(tester, 'has:reply from:ben');
    expect(find.text('1 match'), findsOneWidget);
    await type(tester, 'mentions:ana');
    expect(find.text('1 match'), findsOneWidget);
    expect(find.textContaining('Typo in the second paragraph'), findsOneWidget);
  });

  group('wiring (the chat screen cannot run in a widget test)', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the chat tells the sheet who is searching', () {
      expect(read('lib/widgets/chat/chat_surface.dart').contains('                usersById: usersById,\n                meUid: meUid,\n                onJump: _jumpTo,\n              ),\n              _ChatMenuAction.pinned'), isTrue);
    });

    test('the sheet searches with the filters, and with who is searching', () {
      final s = read('lib/widgets/chat/search_sheet.dart');
      expect(s.contains('    final found = searchMessages(\n      widget.messages,\n      _query,\n      usersById: widget.usersById,\n      meUid: widget.meUid,\n    );'), isTrue);
      expect(s.contains('    final next = toggleToken(_controller.text, token);'), isTrue);
      expect(s.contains('for (final problem in found.parsed.problems)'), isTrue);
      expect(s.contains('selected: hasToken(_query, c.token),'), isTrue);
      expect(s.contains('for (final c in searchChips)'), isTrue);
    });

    test('the old substring search is gone', () {
      final s = read('lib/widgets/chat/search_sheet.dart');
      expect(s.contains('.contains(q)'), isFalse);
      expect(s.contains('toLowerCase()'), isFalse);
    });

    test('days are counted in calendar days: the next day is built from the date, not from 24 hours', () {
      expect(read('lib/utils/search_filters.dart').contains('DateTime _nextDay(DateTime d) => DateTime(d.year, d.month, d.day + 1);'), isTrue);
    });
  });
}
