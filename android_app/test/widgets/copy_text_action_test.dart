import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';

ChatMessage _msg(String text, {Object? audioURL, String? imageURL}) =>
    ChatMessage.fromMap('m1', {
      'text': text,
      'audioURL': audioURL,
      'imageURL': imageURL,
      'author': {'uid': 'ana', 'name': 'Ana'},
    });

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  /// What the stand-in clipboard was asked to hold; null if never asked.
  String? copied;
  bool clipboardFails = false;

  setUp(() {
    copied = null;
    clipboardFails = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'Clipboard.setData') {
            if (clipboardFails) throw PlatformException(code: 'no');
            copied = (call.arguments as Map)['text'] as String?;
          }
          return null;
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  Future<void> pumpRow(
    WidgetTester tester,
    ChatMessage message, {
    Map<String, UserProfile> users = const {},
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
              usersById: users,
              emojiByName: const {},
              canDeleteAny: false,
              onReply: (_) {},
            ),
          ),
        ),
      ),
    );
  }

  Future<void> openMenu(WidgetTester tester, Finder on) async {
    await tester.longPress(on);
    await tester.pumpAndSettle();
  }

  testWidgets('long-press offers Copy text for a message with text', (tester) async {
    await pumpRow(tester, _msg('hello there'));
    await openMenu(tester, find.text('hello there', findRichText: true));
    expect(find.text('Copy text'), findsOneWidget);
    expect(find.text('Reply'), findsOneWidget, reason: 'the others are still there');
  });

  testWidgets('tapping it copies the text, closes the menu and says Copied', (tester) async {
    await pumpRow(tester, _msg('hello there'));
    await openMenu(tester, find.text('hello there', findRichText: true));
    await tester.tap(find.text('Copy text'));
    await tester.pumpAndSettle();
    expect(copied, 'hello there');
    expect(find.text('Copy text'), findsNothing, reason: 'the menu closed');
    expect(find.text('Copied'), findsOneWidget);
  });

  testWidgets('a mention is copied as the name people see', (tester) async {
    final cara = UserProfile.fromMap('cara123', {'name': 'Cara Diaz', 'email': 'c@x.test'});
    await pumpRow(tester, _msg('thanks <@cara123>'), users: {'cara123': cara});
    await openMenu(tester, find.text('Ana'));
    await tester.tap(find.text('Copy text'));
    await tester.pumpAndSettle();
    expect(copied, 'thanks @Cara Diaz');
  });

  testWidgets('a clipboard that refuses says so instead of claiming it worked', (tester) async {
    clipboardFails = true;
    await pumpRow(tester, _msg('hello there'));
    await openMenu(tester, find.text('hello there', findRichText: true));
    await tester.tap(find.text('Copy text'));
    await tester.pumpAndSettle();
    expect(copied, isNull);
    expect(find.text("Couldn't copy"), findsOneWidget);
    expect(find.text('Copied'), findsNothing);
  });

  testWidgets('a voice message or a picture with no words has nothing to copy', (tester) async {
    await pumpRow(tester, _msg('', audioURL: 'data:audio/mp4;base64,AAAA'));
    await openMenu(tester, find.text('Ana'));
    expect(find.text('Reply'), findsOneWidget, reason: 'the menu did open');
    expect(find.text('Copy text'), findsNothing);
  });
}
