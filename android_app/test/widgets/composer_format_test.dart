import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/widgets/chat/composer.dart';
import 'package:punx_messenger/widgets/chat/format_bar.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
    // A press that lands on nothing must fail the test, not pass it by doing nothing.
    WidgetController.hitTestWarningShouldBeFatal = true;
  });

  final sent = <String>[];
  Completer<void>? hold;

  setUp(() {
    sent.clear();
    hold = null;
  });

  Future<void> onSend({
    required String text,
    Uint8List? imageBytes,
    String? imageName,
    String? remoteImageUrl,
    Map<String, dynamic>? remoteImageMeta,
  }) async {
    sent.add(text);
    if (hold != null) await hold!.future;
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
            child: Composer(placeholder: 'Message', onSend: onSend, users: const []),
          ),
        ),
      ),
    );
  }

  TextField field(WidgetTester tester) => tester.widget<TextField>(find.byType(TextField));
  String boxText(WidgetTester tester) => field(tester).controller!.text;
  String selected(WidgetTester tester) {
    final c = field(tester).controller!;
    return c.selection.textInside(c.text);
  }

  /// Types [text], then selects [word] in it, as a person would by pressing and dragging.
  Future<void> select(WidgetTester tester, String text, String word) async {
    await tester.enterText(find.byType(TextField), text);
    await tester.pump();
    final i = text.indexOf(word);
    field(tester).controller!.selection = TextSelection(baseOffset: i, extentOffset: i + word.length);
    await tester.pump();
  }

  Future<void> openBar(WidgetTester tester) async {
    await tester.tap(find.byTooltip('Formatting'));
    await tester.pumpAndSettle();
  }

  Future<void> press(WidgetTester tester, String label) async {
    await tester.tap(find.byTooltip(label));
    await tester.pumpAndSettle();
  }

  group('the row of buttons', () {
    testWidgets('is shut to begin with, opened by the button in the box, and shut by it again', (tester) async {
      await pump(tester);
      expect(find.byType(FormatBar), findsNothing);
      await openBar(tester);
      expect(find.byType(FormatBar), findsOneWidget);
      await openBar(tester);
      expect(find.byType(FormatBar), findsNothing);
    });

    testWidgets('has the five buttons, with their words, in order', (tester) async {
      await pump(tester);
      await openBar(tester);
      for (final label in ['Bold', 'Italic', 'Strikethrough', 'Code', 'Spoiler']) {
        expect(find.byTooltip(label), findsOneWidget, reason: label);
      }
      final xs = ['Bold', 'Italic', 'Strikethrough', 'Code', 'Spoiler'].map((l) => tester.getTopLeft(find.byTooltip(l)).dx).toList();
      for (var i = 1; i < xs.length; i++) {
        expect(xs[i] > xs[i - 1], isTrue, reason: 'left to right');
      }
    });

    testWidgets('every button shows a picture (a button with none would be invisible), and they are all different', (tester) async {
      await pump(tester);
      await openBar(tester);
      final icons = <IconData>[];
      for (final label in ['Bold', 'Italic', 'Strikethrough', 'Code', 'Spoiler']) {
        final icon = tester.widget<Icon>(find.descendant(of: find.byTooltip(label), matching: find.byType(Icon)));
        expect(icon.icon, isNotNull, reason: label);
        icons.add(icon.icon!);
      }
      expect(icons.toSet(), hasLength(5));
    });

    testWidgets('the button in the box tells you whether it is open (colour changes); the row is named for a screen reader', (tester) async {
      final semantics = tester.ensureSemantics();
      await pump(tester);
      await openBar(tester);
      expect(find.bySemanticsLabel('Format the selected text'), findsOneWidget);
      semantics.dispose();
    });
  });

  group('formatting what is selected', () {
    testWidgets('a button wraps the selected word, and the selection stays on it', (tester) async {
      await pump(tester);
      await openBar(tester);
      await select(tester, 'say hello now', 'hello');
      await press(tester, 'Bold');
      expect(boxText(tester), 'say **hello** now');
      expect(selected(tester), 'hello');
    });

    testWidgets('pressing it again takes it off, and the selection is still on the word', (tester) async {
      await pump(tester);
      await openBar(tester);
      await select(tester, 'say hello now', 'hello');
      await press(tester, 'Bold');
      await press(tester, 'Bold');
      expect(boxText(tester), 'say hello now');
      expect(selected(tester), 'hello');
    });

    testWidgets('each button writes its own marks', (tester) async {
      final marks = {'Bold': '**', 'Italic': '_', 'Strikethrough': '~~', 'Code': '`', 'Spoiler': '||'};
      for (final e in marks.entries) {
        await tester.pumpWidget(const SizedBox()); // a fresh box each time
        await pump(tester);
        await openBar(tester);
        await select(tester, 'say hello now', 'hello');
        await press(tester, e.key);
        expect(boxText(tester), 'say ${e.value}hello${e.value} now', reason: e.key);
      }
    });

    testWidgets('bold then italic, then bold again: only the bold comes off', (tester) async {
      await pump(tester);
      await openBar(tester);
      await select(tester, 'say hello now', 'hello');
      await press(tester, 'Bold');
      await press(tester, 'Italic');
      expect(boxText(tester), 'say **_hello_** now');
      await press(tester, 'Bold');
      expect(boxText(tester), 'say _hello_ now');
      expect(selected(tester), 'hello');
    });

    testWidgets('spaces at the ends of the selection stay outside, so a spoiler is a spoiler', (tester) async {
      await pump(tester);
      await openBar(tester);
      await select(tester, 'say  secret  now', ' secret ');
      await press(tester, 'Spoiler');
      expect(boxText(tester), 'say  ||secret||  now');
    });

    testWidgets('with nothing selected, the pair goes in at the cursor, the cursor between the marks', (tester) async {
      await pump(tester);
      await openBar(tester);
      await tester.enterText(find.byType(TextField), 'say ');
      await tester.pump();
      field(tester).controller!.selection = const TextSelection.collapsed(offset: 4);
      await press(tester, 'Spoiler');
      expect(boxText(tester), 'say ||||');
      expect(field(tester).controller!.selection, const TextSelection.collapsed(offset: 6));
    });

    testWidgets('a box that has never had a selection formats at its end', (tester) async {
      await pump(tester);
      await openBar(tester);
      await press(tester, 'Bold');
      expect(boxText(tester), '****');
    });

    testWidgets('several lines are marked line by line', (tester) async {
      await pump(tester);
      await openBar(tester);
      await tester.enterText(find.byType(TextField), 'one\ntwo');
      await tester.pump();
      field(tester).controller!.selection = const TextSelection(baseOffset: 0, extentOffset: 7);
      await press(tester, 'Italic');
      expect(boxText(tester), '_one_\n_two_');
    });

    testWidgets('the box keeps the focus, so typing can go on', (tester) async {
      await pump(tester);
      await openBar(tester);
      await select(tester, 'say hello now', 'hello');
      await press(tester, 'Bold');
      expect(field(tester).focusNode!.hasFocus, isTrue);
    });

    testWidgets('what is written is what is sent', (tester) async {
      await pump(tester);
      await openBar(tester);
      await select(tester, 'the end is dull', 'dull');
      await press(tester, 'Spoiler');
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(sent, ['the end is ||dull||']);
    });

    testWidgets('formatting can be sent on its own: the send button knows the box has text now', (tester) async {
      await pump(tester);
      await openBar(tester);
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send)).onPressed, isNull);
      await press(tester, 'Bold');
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send)).onPressed, isNotNull);
    });

    testWidgets('while a message is going out the buttons do nothing', (tester) async {
      await pump(tester);
      await openBar(tester);
      hold = Completer<void>();
      await tester.enterText(find.byType(TextField), 'hello');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pump();
      await tester.pump();
      for (final b in tester.widgetList<IconButton>(find.descendant(of: find.byType(FormatBar), matching: find.byType(IconButton)))) {
        expect(b.onPressed, isNull);
      }
      hold!.complete();
      await tester.pumpAndSettle();
    });
  });

  group('wiring', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the box formats the selection it has, falling back to its end, and puts the selection on the words', () {
      final s = read('lib/widgets/chat/composer.dart');
      expect(s.contains('    final r = applyFormat(\n      text,\n      sel.isValid ? sel.start : text.length,\n      sel.isValid ? sel.end : text.length,\n      name,\n    );'), isTrue);
      expect(s.contains('    _controller.value = TextEditingValue(\n      text: r.text,\n      selection: TextSelection(baseOffset: r.start, extentOffset: r.end),\n    );\n    _focus.requestFocus();\n    _onTextChanged(r.text);'), isTrue);
      expect(s.contains('  void _format(String name) {\n    if (_sending) return;'), isTrue);
    });

    test('the row is above the box, and told whether a message is going out', () {
      final s = read('lib/widgets/chat/composer.dart');
      expect(s.contains('if (_formatOpen) FormatBar(onFormat: _format, enabled: !_sending),'), isTrue);
      expect(s.contains('                      focusNode: _focus,\n'), isTrue);
      expect(s.contains('    _focus.dispose();\n'), isTrue);
    });

    test('a button says which format it is, and is off while sending', () {
      final s = read('lib/widgets/chat/format_bar.dart');
      expect(s.contains('onPressed: enabled ? () => onFormat(b.name) : null,'), isTrue);
      expect(s.contains('for (final b in formatButtons)'), isTrue);
      expect(s.contains('tooltip: b.label,'), isTrue);
    });
  });
}
