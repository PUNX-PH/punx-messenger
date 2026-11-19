import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/utils/attachments.dart';
import 'package:punx_messenger/widgets/chat/composer.dart';

/// A real 1x1 picture, so a thumbnail decodes rather than showing the broken-image box.
final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
);

Attachment pic(String name) => Attachment(bytes: _png, name: name);

typedef Sent = ({String text, String? file});

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
    // A press that lands on nothing must fail the test, not pass it by doing nothing.
    WidgetController.hitTestWarningShouldBeFatal = true;
  });

  final sent = <Sent>[];
  Object? failOn; // fail the Nth message (index) with this error
  int? failIndex;
  Completer<void>? hold; // the message at holdIndex waits for this
  int? holdIndex;
  var pickResult = <Attachment>[];
  Object? pickError;
  var pickCalls = 0;

  setUp(() {
    sent.clear();
    failOn = null;
    failIndex = null;
    hold = null;
    holdIndex = null;
    pickResult = [];
    pickError = null;
    pickCalls = 0;
  });

  Future<void> onSend({
    required String text,
    Uint8List? imageBytes,
    String? imageName,
    String? remoteImageUrl,
    Map<String, dynamic>? remoteImageMeta,
  }) async {
    final n = sent.length;
    sent.add((text: text, file: imageName));
    if (holdIndex == n) await hold!.future;
    if (failIndex == n) throw failOn!;
  }

  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: Composer(
              placeholder: 'Message',
              onSend: onSend,
              users: const [],
              pickImages: () async {
                pickCalls++;
                if (pickError != null) throw pickError!;
                return pickResult;
              },
            ),
          ),
        ),
      ),
    );
  }

  Future<void> choose(WidgetTester tester, List<Attachment> files) async {
    pickResult = files;
    await tester.tap(find.byTooltip('Add pictures'));
    await tester.pumpAndSettle();
  }

  Future<void> send(WidgetTester tester) async {
    await tester.tap(find.byTooltip('Send message'));
    await tester.pumpAndSettle();
  }

  Finder tile(String name) => find.byTooltip('Remove $name');
  String boxText(WidgetTester tester) => tester.widget<TextField>(find.byType(TextField)).controller!.text;
  final unavailable = FirebaseException(plugin: 'cloud_firestore', code: 'unavailable');

  group('choosing', () {
    testWidgets('the picture button opens the gallery, and what is chosen shows as thumbnails in order', (tester) async {
      await pump(tester);
      expect(find.byTooltip('Add pictures'), findsOneWidget);
      expect(tile('a.png'), findsNothing, reason: 'nothing yet');
      await choose(tester, [pic('a.png'), pic('b.png'), pic('c.png')]);
      expect(pickCalls, 1);
      expect(find.bySemanticsLabel('3 pictures to send'), findsOneWidget);
      final xs = ['a.png', 'b.png', 'c.png'].map((n) => tester.getTopLeft(tile(n)).dx).toList();
      expect(xs[0] < xs[1] && xs[1] < xs[2], isTrue, reason: 'left to right, as chosen');
      expect(tester.takeException(), isNull);
    });

    testWidgets('one picture is "1 picture"', (tester) async {
      await pump(tester);
      await choose(tester, [pic('a.png')]);
      expect(find.bySemanticsLabel('1 picture to send'), findsOneWidget);
    });

    testWidgets('choosing again adds to them, and a picture chosen twice is one', (tester) async {
      await pump(tester);
      await choose(tester, [pic('a.png'), pic('b.png')]);
      await choose(tester, [pic('b.png'), pic('c.png')]);
      expect(find.bySemanticsLabel('3 pictures to send'), findsOneWidget);
      expect(tile('b.png'), findsOneWidget);
    });

    testWidgets('closing the gallery without choosing changes nothing', (tester) async {
      await pump(tester);
      await choose(tester, [pic('a.png')]);
      await choose(tester, const []);
      expect(find.bySemanticsLabel('1 picture to send'), findsOneWidget);
      expect(find.textContaining('left out'), findsNothing);
    });

    testWidgets('ten at most: the rest are left out, and it says so, without losing the ten', (tester) async {
      await pump(tester);
      await choose(tester, [for (var i = 0; i < 12; i++) pic('p$i.png')]);
      expect(find.bySemanticsLabel('10 pictures to send'), findsOneWidget);
      expect(find.text('2 images left out: at most 10 at a time.'), findsOneWidget);
      expect(tile('p0.png'), findsOneWidget, reason: 'the first are the ones kept');
      expect(tile('p10.png'), findsNothing);
      expect(tile('p11.png'), findsNothing);
    });

    testWidgets('a picture over 10 MB is not taken, and it says so', (tester) async {
      await pump(tester);
      await choose(tester, [pic('ok.png'), Attachment(bytes: Uint8List(maxAttachmentBytes + 1), name: 'huge.jpg')]);
      expect(find.text('1 image is over 10 MB.'), findsOneWidget);
      expect(tile('huge.jpg'), findsNothing);
      expect(tile('ok.png'), findsOneWidget);
    });

    testWidgets('the sentence goes away when the next choice has nothing wrong', (tester) async {
      await pump(tester);
      await choose(tester, [for (var i = 0; i < 11; i++) pic('p$i.png')]);
      expect(find.textContaining('left out'), findsOneWidget);
      await choose(tester, [pic('p0.png')]);
      expect(find.textContaining('left out'), findsNothing);
    });

    testWidgets('a gallery that cannot be opened is said, in words', (tester) async {
      await pump(tester);
      pickError = StateError('no access to photos');
      await tester.tap(find.byTooltip('Add pictures'));
      await tester.pumpAndSettle();
      expect(find.text('no access to photos'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a thumbnail can be taken back out, and only that one', (tester) async {
      await pump(tester);
      await choose(tester, [pic('a.png'), pic('b.png'), pic('c.png')]);
      await tester.tap(tile('b.png'));
      await tester.pumpAndSettle();
      expect(tile('a.png'), findsOneWidget);
      expect(tile('b.png'), findsNothing);
      expect(tile('c.png'), findsOneWidget);
      expect(find.bySemanticsLabel('2 pictures to send'), findsOneWidget);
    });

    testWidgets('taking out the last one leaves no tray', (tester) async {
      await pump(tester);
      await choose(tester, [pic('a.png')]);
      await tester.tap(tile('a.png'));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel(RegExp(r'to send')), findsNothing);
      expect(find.byType(ListView), findsNothing);
    });

    testWidgets('a thumbnail that is not a picture shows a placeholder rather than failing the box', (tester) async {
      await pump(tester);
      await choose(tester, [Attachment(bytes: Uint8List.fromList([1, 2, 3]), name: 'broken.jpg')]);
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.broken_image_outlined), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('sending', () {
    testWidgets('a picture alone can be sent, with no words', (tester) async {
      await pump(tester);
      await choose(tester, [pic('a.png')]);
      await send(tester);
      expect(sent, [(text: '', file: 'a.png')]);
      expect(find.bySemanticsLabel(RegExp(r'to send')), findsNothing, reason: 'the tray is empty after');
    });

    testWidgets('several: one message each, in order, with the words on the first only', (tester) async {
      await pump(tester);
      await tester.enterText(find.byType(TextField), 'look at these');
      await choose(tester, [pic('a.png'), pic('b.png'), pic('c.png')]);
      await send(tester);
      expect(sent, [(text: 'look at these', file: 'a.png'), (text: '', file: 'b.png'), (text: '', file: 'c.png')]);
      expect(boxText(tester), '');
      expect(find.bySemanticsLabel(RegExp(r'to send')), findsNothing);
    });

    testWidgets('the pictures go in the order of the tray after one was taken out', (tester) async {
      await pump(tester);
      await choose(tester, [pic('a.png'), pic('b.png'), pic('c.png')]);
      await tester.tap(tile('a.png'));
      await tester.pumpAndSettle();
      await send(tester);
      expect(sent.map((s) => s.file), ['b.png', 'c.png']);
    });

    testWidgets('words only still go as one message', (tester) async {
      await pump(tester);
      await tester.enterText(find.byType(TextField), 'hi');
      await tester.pump();
      await send(tester);
      expect(sent, [(text: 'hi', file: null)]);
    });

    testWidgets('send is off with nothing to send, and on with only a picture', (tester) async {
      await pump(tester);
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send)).onPressed, isNull);
      await choose(tester, [pic('a.png')]);
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send)).onPressed, isNotNull);
    });

    testWidgets('while they go it says which, and nothing can be added or taken out', (tester) async {
      await pump(tester);
      hold = Completer<void>();
      holdIndex = 1;
      await choose(tester, [pic('a.png'), pic('b.png'), pic('c.png')]);
      await tester.tap(find.byTooltip('Send message'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Uploading 2 of 3…'), findsOneWidget);
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.add_photo_alternate_outlined)).onPressed, isNull);
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.close).first).onPressed, isNull);
      hold!.complete();
      await tester.pumpAndSettle();
      expect(find.textContaining('Uploading'), findsNothing);
      expect(sent, hasLength(3));
    });

    testWidgets('while they go, send cannot be pressed again', (tester) async {
      await pump(tester);
      hold = Completer<void>();
      holdIndex = 0;
      await tester.enterText(find.byType(TextField), 'hi');
      await choose(tester, [pic('a.png')]);
      await tester.tap(find.byTooltip('Send message'));
      await tester.pump();
      await tester.pump();
      final sending = find.ancestor(of: find.byType(CircularProgressIndicator), matching: find.byType(IconButton));
      expect(sending, findsOneWidget);
      expect(tester.widget<IconButton>(sending).onPressed, isNull, reason: 'a second press would send everything twice');
      hold!.complete();
      await tester.pumpAndSettle();
      expect(sent, hasLength(1));
    });

    testWidgets('one picture says "Uploading…"', (tester) async {
      await pump(tester);
      hold = Completer<void>();
      holdIndex = 0;
      await choose(tester, [pic('a.png')]);
      await tester.tap(find.byTooltip('Send message'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Uploading…'), findsOneWidget);
      hold!.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('words only show no progress line', (tester) async {
      await pump(tester);
      hold = Completer<void>();
      holdIndex = 0;
      await tester.enterText(find.byType(TextField), 'hi');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pump();
      expect(find.textContaining('Uploading'), findsNothing);
      hold!.complete();
      await tester.pumpAndSettle();
    });
  });

  group('when one fails', () {
    testWidgets('the first fails: nothing went, so all of it is kept for another try', (tester) async {
      await pump(tester);
      failOn = unavailable;
      failIndex = 0;
      await tester.enterText(find.byType(TextField), 'look');
      await choose(tester, [pic('a.png'), pic('b.png')]);
      await send(tester);
      expect(sent, hasLength(1), reason: 'it stopped');
      expect(find.textContaining("you couldn't send that message"), findsOneWidget);
      expect(find.textContaining('Sent '), findsNothing);
      expect(boxText(tester), 'look');
      expect(find.bySemanticsLabel('2 pictures to send'), findsOneWidget);
    });

    testWidgets('a later one fails: it says how far it got, the words are spent, the rest wait', (tester) async {
      await pump(tester);
      failOn = unavailable;
      failIndex = 1;
      await tester.enterText(find.byType(TextField), 'look');
      await choose(tester, [pic('a.png'), pic('b.png'), pic('c.png')]);
      await send(tester);
      expect(sent.map((s) => s.file), ['a.png', 'b.png'], reason: 'c.png was never tried');
      expect(find.textContaining('Sent 1 of 3. '), findsOneWidget);
      expect(find.textContaining("you couldn't send that message"), findsOneWidget);
      expect(boxText(tester), '', reason: 'the words went with the first');
      expect(tile('a.png'), findsNothing);
      expect(tile('b.png'), findsOneWidget);
      expect(tile('c.png'), findsOneWidget);
    });

    testWidgets('trying again sends only what had not gone, with no words', (tester) async {
      await pump(tester);
      failOn = unavailable;
      failIndex = 1;
      await tester.enterText(find.byType(TextField), 'look');
      await choose(tester, [pic('a.png'), pic('b.png'), pic('c.png')]);
      await send(tester);
      sent.clear();
      failIndex = null;
      await send(tester);
      expect(sent, [(text: '', file: 'b.png'), (text: '', file: 'c.png')]);
      expect(find.bySemanticsLabel(RegExp(r'to send')), findsNothing);
      expect(find.textContaining('Sent '), findsNothing, reason: 'the old sentence is gone');
    });

    testWidgets('one picture failing says nothing about "Sent"', (tester) async {
      await pump(tester);
      failOn = unavailable;
      failIndex = 0;
      await choose(tester, [pic('a.png')]);
      await send(tester);
      expect(find.textContaining('Sent '), findsNothing);
      expect(find.textContaining("you couldn't send that message"), findsOneWidget);
      expect(tile('a.png'), findsOneWidget);
    });

    testWidgets('after a failure the box can be used again', (tester) async {
      await pump(tester);
      failOn = unavailable;
      failIndex = 0;
      await choose(tester, [pic('a.png')]);
      await send(tester);
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send)).onPressed, isNotNull);
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.add_photo_alternate_outlined)).onPressed, isNotNull);
      expect(find.textContaining('Uploading'), findsNothing);
    });

    testWidgets('the last one failing leaves just that one', (tester) async {
      await pump(tester);
      failOn = unavailable;
      failIndex = 2;
      await choose(tester, [pic('a.png'), pic('b.png'), pic('c.png')]);
      await send(tester);
      expect(find.textContaining('Sent 2 of 3. '), findsOneWidget);
      expect(find.bySemanticsLabel('1 picture to send'), findsOneWidget);
      expect(tile('c.png'), findsOneWidget);
    });
  });

  group('wiring (the gallery and the chat screens cannot run in a widget test)', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the gallery lets several be chosen and reads each one\'s bytes and name', () {
      final s = read('lib/services/attachment_picker.dart');
      expect(s.contains('await ImagePicker().pickMultiImage();'), isTrue);
      expect(s.contains('Attachment(bytes: await f.readAsBytes(), name: f.name)'), isTrue);
    });

    test('the composer uses that gallery unless told otherwise, and shows what it returns', () {
      final s = read('lib/widgets/chat/composer.dart');
      expect(s.contains('    this.pickImages = pickAttachments,\n'), isTrue);
      expect(s.contains('      picked = await widget.pickImages();'), isTrue);
      expect(s.contains('    final added = addAttachments(_files, picked);'), isTrue);
      expect(s.contains('        files: sentFiles,\n'), isTrue);
    });

    test('the text and the picture go to the chat as before, one message per picture', () {
      final s = read('lib/widgets/chat/composer.dart');
      expect(
        s.contains(
          '        send: ({required text, file}) => widget.onSend(\n'
          '          text: text,\n'
          '          imageBytes: file?.bytes,\n'
          '          imageName: file?.name,\n'
          '        ),',
        ),
        isTrue,
      );
    });

    test('only the first message of a conversation quotes what is being replied to: the controller clears it after one', () {
      final s = read('lib/providers/messages_providers.dart');
      expect(s.contains('    if (replyTo == null) setReplyingTo(null);'), isTrue);
    });

    test('in a thread every picture quotes the thread\'s message, so all of them stay in it', () {
      final s = read('lib/widgets/chat/thread_screen.dart');
      expect(s.contains('                        replyTo: root,\n'), isTrue);
    });

    test('there is no longer a single-picture path left behind', () {
      final s = read('lib/widgets/chat/composer.dart');
      expect(s.contains('_imageBytes'), isFalse);
      expect(s.contains('pickImage('), isFalse);
      expect(s.contains('_ImagePreview'), isFalse);
    });
  });
}
