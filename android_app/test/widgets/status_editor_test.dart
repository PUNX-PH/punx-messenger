import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/custom_status.dart';
import 'package:punx_messenger/models/dm_convo.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/dm_providers.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/providers/users_providers.dart';
import 'package:punx_messenger/screens/dms/dms_list_screen.dart';
import 'package:punx_messenger/services/users_repository.dart';
import 'package:punx_messenger/widgets/shared/status_editor_sheet.dart';

/// Records what the sheet asks for instead of touching Firestore.
class _FakeUsersRepository implements UsersRepository {
  final calls = <({String uid, Map<String, Object?>? status})>[];
  Object? failWith;

  /// When set, a save waits for this before finishing (to look at the sheet mid-save).
  Completer<void>? hold;

  @override
  Future<void> setMyStatus(String uid, Map<String, Object?>? status) async {
    if (hold != null) await hold!.future;
    if (failWith != null) throw failWith!;
    calls.add((uid: uid, status: status));
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

UserProfile _me({CustomStatus? status}) => UserProfile(
  id: 'me',
  email: 'me@x.test',
  name: 'Me',
  role: Role.employee,
  customStatus: status,
);

int _in(Duration d) => DateTime.now().add(d).millisecondsSinceEpoch;

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<_FakeUsersRepository> pumpRow(WidgetTester tester, {CustomStatus? status}) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final repo = _FakeUsersRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          usersRepositoryProvider.overrideWithValue(repo),
          profileProvider.overrideWith((ref) => Stream.value(_me(status: status))),
        ],
        child: const MaterialApp(home: Scaffold(body: StatusRow())),
      ),
    );
    await tester.pumpAndSettle();
    return repo;
  }

  Future<void> openEditor(WidgetTester tester) async {
    await tester.tap(find.byType(ListTile));
    await tester.pumpAndSettle();
  }

  final saveButton = find.widgetWithText(FilledButton, 'Save');
  bool saveEnabled(WidgetTester tester) => tester.widget<FilledButton>(saveButton).onPressed != null;
  Finder field() => find.byType(TextField);
  String typed(WidgetTester tester) => tester.widget<TextField>(field()).controller!.text;

  group('the row in the profile sheet', () {
    testWidgets('with no status it invites you to set one', (tester) async {
      await pumpRow(tester);
      expect(find.text('Set a status'), findsOneWidget);
      expect(find.text('Tap to change it'), findsNothing);
    });

    testWidgets('with a status it shows it', (tester) async {
      await pumpRow(tester, status: const CustomStatus(text: 'Out sick'));
      expect(find.text('Out sick'), findsOneWidget);
      expect(find.text('Tap to change it'), findsOneWidget);
    });

    testWidgets('an expired one reads as none', (tester) async {
      await pumpRow(tester, status: CustomStatus(text: 'Out sick', until: _in(const Duration(minutes: -1))));
      expect(find.text('Set a status'), findsOneWidget);
    });

    testWidgets('one that has not ended yet is shown', (tester) async {
      await pumpRow(tester, status: CustomStatus(text: 'Out sick', until: _in(const Duration(hours: 1))));
      expect(find.text('Out sick'), findsOneWidget);
    });
  });

  group('the editor', () {
    testWidgets('opens empty with Save off, and no Clear when there is nothing to clear', (tester) async {
      await pumpRow(tester);
      await openEditor(tester);
      expect(typed(tester), '');
      expect(saveEnabled(tester), isFalse);
      expect(find.text('Clear status'), findsNothing);
      expect(find.text('Clear after'), findsOneWidget);
    });

    testWidgets('opens with your current status filled in, and offers to clear it', (tester) async {
      await pumpRow(tester, status: const CustomStatus(text: 'Out sick'));
      await openEditor(tester);
      expect(typed(tester), 'Out sick');
      expect(saveEnabled(tester), isTrue);
      expect(find.text('Clear status'), findsOneWidget);
    });

    testWidgets('an expired status is not put back in the box, and has nothing to clear', (tester) async {
      await pumpRow(tester, status: CustomStatus(text: 'Out sick', until: _in(const Duration(minutes: -5))));
      await openEditor(tester);
      expect(typed(tester), '');
      expect(find.text('Clear status'), findsNothing);
    });

    testWidgets('Save turns on when there is text, and stays off for blanks', (tester) async {
      await pumpRow(tester);
      await openEditor(tester);
      await tester.enterText(field(), '   ');
      await tester.pump();
      expect(saveEnabled(tester), isFalse);
      await tester.enterText(field(), 'Busy');
      await tester.pump();
      expect(saveEnabled(tester), isTrue);
    });

    testWidgets('it holds at most 60 characters', (tester) async {
      await pumpRow(tester);
      await openEditor(tester);
      await tester.enterText(field(), 'x' * 100);
      await tester.pump();
      expect(typed(tester).length, 60);
    });

    testWidgets('every ready-made status is on offer, and tapping one fills the box', (tester) async {
      await pumpRow(tester);
      await openEditor(tester);
      for (final p in ['In a meeting', 'On leave', 'Out sick', 'Working remotely', 'Heads down']) {
        expect(find.widgetWithText(ActionChip, p), findsOneWidget, reason: p);
      }
      await tester.tap(find.widgetWithText(ActionChip, 'Working remotely'));
      await tester.pump();
      expect(typed(tester), 'Working remotely');
      expect(saveEnabled(tester), isTrue);
    });

    testWidgets('every length is on offer and Today is chosen to begin with', (tester) async {
      await pumpRow(tester);
      await openEditor(tester);
      for (final l in ['Today', '1 hour', '4 hours', '7 days', "Don't clear"]) {
        expect(find.widgetWithText(ChoiceChip, l), findsOneWidget, reason: l);
      }
      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Today')).selected, isTrue);
      await tester.tap(find.widgetWithText(ChoiceChip, '4 hours'));
      await tester.pump();
      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, '4 hours')).selected, isTrue);
      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Today')).selected, isFalse);
    });

    testWidgets('Save writes the cleaned text for you, ending at the end of today, and closes', (tester) async {
      final repo = await pumpRow(tester);
      await openEditor(tester);
      await tester.enterText(field(), '  Working   remotely ');
      await tester.pump();
      await tester.tap(saveButton);
      await tester.pumpAndSettle();
      expect(repo.calls, hasLength(1));
      expect(repo.calls.single.uid, 'me');
      expect(repo.calls.single.status!['text'], 'Working remotely');
      final now = DateTime.now();
      expect(repo.calls.single.status!['until'], DateTime(now.year, now.month, now.day, 23, 59, 59, 999).millisecondsSinceEpoch);
      expect(find.text('Clear after'), findsNothing, reason: 'the sheet closed');
    });

    testWidgets('a chosen length is what is written', (tester) async {
      final repo = await pumpRow(tester);
      await openEditor(tester);
      await tester.enterText(field(), 'Busy');
      await tester.tap(find.widgetWithText(ChoiceChip, '1 hour'));
      await tester.pump();
      await tester.tap(saveButton);
      await tester.pumpAndSettle();
      final until = repo.calls.single.status!['until'] as int;
      expect(until, closeTo(_in(const Duration(hours: 1)), 60000));
    });

    testWidgets('"Don\'t clear" writes no end', (tester) async {
      final repo = await pumpRow(tester);
      await openEditor(tester);
      await tester.enterText(field(), 'Busy');
      await tester.tap(find.widgetWithText(ChoiceChip, "Don't clear"));
      await tester.pump();
      await tester.tap(saveButton);
      await tester.pumpAndSettle();
      expect(repo.calls.single.status, {'text': 'Busy', 'until': null});
    });

    testWidgets('Clear status clears it and closes', (tester) async {
      final repo = await pumpRow(tester, status: const CustomStatus(text: 'Out sick'));
      await openEditor(tester);
      await tester.tap(find.text('Clear status'));
      await tester.pumpAndSettle();
      expect(repo.calls, [(uid: 'me', status: null)]);
      expect(find.text('Clear after'), findsNothing);
    });

    testWidgets('Cancel closes without writing anything', (tester) async {
      final repo = await pumpRow(tester);
      await openEditor(tester);
      await tester.enterText(field(), 'Busy');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(repo.calls, isEmpty);
      expect(find.text('Clear after'), findsNothing);
    });

    testWidgets('while it is saving everything is held still, and a second tap saves nothing more', (tester) async {
      final repo = await pumpRow(tester, status: const CustomStatus(text: 'Out sick'));
      repo.hold = Completer<void>();
      await openEditor(tester);
      await tester.tap(saveButton);
      await tester.pump();
      expect(find.text('Saving…'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Saving…')).onPressed, isNull);
      expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Cancel')).onPressed, isNull);
      expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Clear status')).onPressed, isNull);
      expect(tester.widget<TextField>(field()).enabled, isFalse);
      // The keyboard's Done key counts as a second tap.
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      repo.hold!.complete();
      await tester.pumpAndSettle();
      expect(repo.calls, hasLength(1));
      expect(find.text('Clear after'), findsNothing, reason: 'then it closes');
    });

    testWidgets('when saving fails it says so, stays open and lets you try again', (tester) async {
      final repo = await pumpRow(tester);
      repo.failWith = StateError('offline');
      await openEditor(tester);
      await tester.enterText(field(), 'Busy');
      await tester.pump();
      await tester.tap(saveButton);
      await tester.pumpAndSettle();
      expect(find.text("Couldn't save your status. Try again."), findsOneWidget);
      expect(find.text('Clear after'), findsOneWidget, reason: 'still open');
      expect(saveEnabled(tester), isTrue);
      repo.failWith = null;
      await tester.tap(saveButton);
      await tester.pumpAndSettle();
      expect(repo.calls, hasLength(1));
    });

    testWidgets('when clearing fails it says so too', (tester) async {
      final repo = await pumpRow(tester, status: const CustomStatus(text: 'Out sick'));
      repo.failWith = StateError('offline');
      await openEditor(tester);
      await tester.tap(find.text('Clear status'));
      await tester.pumpAndSettle();
      expect(find.text("Couldn't save your status. Try again."), findsOneWidget);
    });
  });

  group('a status in the DM list', () {
    final now = Timestamp.fromDate(DateTime.now());

    Future<void> pumpDms(WidgetTester tester, {CustomStatus? status}) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final me = _me();
      final zed = UserProfile(
        id: 'zed',
        email: 'zed@x.test',
        name: 'zed',
        role: Role.employee,
        customStatus: status,
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            profileProvider.overrideWith((ref) => Stream.value(me)),
            statusOfProvider.overrideWith((ref, uid) => 'online'),
            activeUsersProvider.overrideWithValue([me, zed]),
            myDmConvosProvider.overrideWith(
              (ref) => Stream.value({
                'zed': DmConvo(id: 'me__zed', members: const ['me', 'zed'], lastMessageAt: now),
              }),
            ),
          ],
          child: const MaterialApp(home: DmsListScreen()),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('shows under their name', (tester) async {
      await pumpDms(tester, status: const CustomStatus(text: 'On leave'));
      expect(find.text('On leave'), findsOneWidget);
    });

    testWidgets('nothing when they have none', (tester) async {
      await pumpDms(tester);
      expect(tester.widget<ListTile>(find.widgetWithText(ListTile, 'zed')).subtitle, isNull);
    });

    testWidgets('nothing when theirs has ended', (tester) async {
      await pumpDms(tester, status: CustomStatus(text: 'On leave', until: _in(const Duration(minutes: -1))));
      expect(find.text('On leave'), findsNothing);
    });
  });

  test("the chat's header shows the other person's status as it is now, and the header can show a line under the title (a pin: the chat screen cannot be built in a widget test)", () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');
    final dm = read('lib/screens/dms/dm_chat_screen.dart');
    expect(
      dm.contains(
        '        subtitle: activeStatusOf(\n          ref.watch(usersByIdProvider)[otherUid] ?? dmContext.other,\n          DateTime.now(),\n        )?.text,',
      ),
      isTrue,
    );
    final chat = read('lib/widgets/chat/chat_surface.dart');
    expect(chat.contains('final String? subtitle;'), isTrue);
    expect(chat.contains('if (widget.subtitle != null)\n                    Text(\n                      widget.subtitle!,'), isTrue);
  });

  test("the profile sheet has the status row", () {
    final s = File('lib/widgets/shared/profile_sheet.dart').readAsStringSync();
    expect(s.contains('const StatusRow(),'), isTrue);
  });

  test("the write is the web's: the status on the person's own document, deleted to clear (a pin: there is no Firestore here)", () {
    final s = File('lib/services/users_repository.dart').readAsStringSync().replaceAll('\r\n', '\n');
    expect(
      s.contains(
        "    final text = cleanStatusText(status?['text']);\n"
        "    final until = status?['until'];\n"
        "    await _db.collection('users').doc(uid).update({\n"
        "      'status': text.isEmpty\n"
        "          ? FieldValue.delete()\n"
        "          : {'text': text, 'until': until is num && until.isFinite ? until : null},\n"
        "    });",
      ),
      isTrue,
    );
  });
}
