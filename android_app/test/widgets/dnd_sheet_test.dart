import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/dnd.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/users_providers.dart';
import 'package:punx_messenger/services/sfx_rules.dart';
import 'package:punx_messenger/services/users_repository.dart';
import 'package:punx_messenger/theme/palette.dart';
import 'package:punx_messenger/widgets/shared/dnd_sheet.dart';
import 'package:punx_messenger/widgets/shared/profile_sheet.dart';

/// Records what the sheet asks for instead of touching Firestore.
class _FakeUsersRepository implements UsersRepository {
  final calls = <({String uid, Map<String, Object?>? dnd})>[];
  Object? failWith;

  /// When set, a write waits for this before finishing (to look at the sheet mid-write).
  Completer<void>? hold;

  @override
  Future<void> setMyDnd(String uid, Map<String, Object?>? dnd) async {
    if (hold != null) await hold!.future;
    if (failWith != null) throw failWith!;
    calls.add((uid: uid, dnd: dnd));
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

UserProfile _me({Dnd? dnd}) => UserProfile(
  id: 'me',
  email: 'me@x.test',
  name: 'Me',
  role: Role.employee,
  dnd: dnd,
);

int _in(Duration d) => DateTime.now().add(d).millisecondsSinceEpoch;

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<_FakeUsersRepository> pump(WidgetTester tester, Widget child, {Dnd? dnd}) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final repo = _FakeUsersRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          usersRepositoryProvider.overrideWithValue(repo),
          profileProvider.overrideWith((ref) => Stream.value(_me(dnd: dnd))),
        ],
        child: MaterialApp(home: Scaffold(body: child)),
      ),
    );
    await tester.pumpAndSettle();
    return repo;
  }

  Future<_FakeUsersRepository> pumpRow(WidgetTester tester, {Dnd? dnd}) =>
      pump(tester, const DndRow(), dnd: dnd);

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.byType(ListTile));
    await tester.pumpAndSettle();
  }

  Color iconColor(WidgetTester tester) =>
      tester.widget<Icon>(find.byIcon(Icons.notifications_off_outlined)).color!;

  group('the row in the profile sheet', () {
    testWidgets('off: just the name, and a dim icon', (tester) async {
      await pumpRow(tester);
      expect(find.text('Do not disturb'), findsOneWidget);
      expect(find.textContaining('Tap to turn it off'), findsNothing);
      expect(iconColor(tester), Palette.inkDim);
    });

    testWidgets('on for ever: says so, with a red icon', (tester) async {
      await pumpRow(tester, dnd: const Dnd());
      expect(find.text('On, until you turn it off. Tap to turn it off.'), findsOneWidget);
      expect(iconColor(tester), Palette.bad);
    });

    testWidgets('on for a while: says until when, in the phone\'s own clock', (tester) async {
      await pumpRow(tester, dnd: Dnd(until: _in(const Duration(minutes: 90))));
      expect(find.textContaining(RegExp(r'^On, until .+\. Tap to turn it off\.$')), findsOneWidget);
      expect(find.textContaining('you turn it off'), findsNothing);
    });

    testWidgets('the time follows the phone clock: 12-hour has AM or PM, 24-hour does not', (tester) async {
      Widget clock(bool h24) => Builder(
        builder: (c) => MediaQuery(
          data: MediaQuery.of(c).copyWith(alwaysUse24HourFormat: h24),
          child: const DndRow(),
        ),
      );
      final soon = Dnd(until: _in(const Duration(minutes: 90)));
      await pump(tester, clock(true), dnd: soon);
      final h24 = (tester.widget<ListTile>(find.byType(ListTile)).subtitle! as Text).data!;
      expect(h24, matches(RegExp(r'\d{1,2}:\d{2}')));
      expect(h24, isNot(contains('AM')));
      expect(h24, isNot(contains('PM')));
      await pump(tester, clock(false), dnd: soon);
      final h12 = (tester.widget<ListTile>(find.byType(ListTile)).subtitle! as Text).data!;
      expect(h12, matches(RegExp(r'(AM|PM)')));
    });

    testWidgets('one that has run out reads as off', (tester) async {
      await pumpRow(tester, dnd: Dnd(until: _in(const Duration(minutes: -1))));
      expect(find.textContaining('Tap to turn it off'), findsNothing);
      expect(iconColor(tester), Palette.inkDim);
    });

    testWidgets('tapping it when it is on switches it off at once: no sheet, a null written', (tester) async {
      final repo = await pumpRow(tester, dnd: const Dnd());
      await openSheet(tester);
      expect(repo.calls.length, 1);
      expect(repo.calls.single.uid, 'me');
      expect(repo.calls.single.dnd, isNull);
      expect(find.text('30 minutes'), findsNothing);
    });

    testWidgets('if turning it off fails you are told, and can try again', (tester) async {
      final repo = await pumpRow(tester, dnd: const Dnd());
      repo.failWith = Exception('offline');
      await openSheet(tester);
      expect(find.text("Couldn't turn it off. Try again."), findsOneWidget);
      repo.failWith = null;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      await openSheet(tester);
      expect(repo.calls.length, 1);
    });

    testWidgets('tapping it when it is off asks how long, and writes nothing yet', (tester) async {
      final repo = await pumpRow(tester);
      await openSheet(tester);
      expect(repo.calls, isEmpty);
      for (final label in ['30 minutes', '1 hour', '4 hours', 'Until 8:00 in the morning', 'Until I turn it off']) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
      expect(find.textContaining('Messages still arrive and show as unread'), findsOneWidget);
    });
  });

  group('the sheet', () {
    testWidgets('a choice writes its end, and closes the sheet', (tester) async {
      final before = DateTime.now().millisecondsSinceEpoch;
      final repo = await pumpRow(tester);
      await openSheet(tester);
      await tester.tap(find.text('1 hour'));
      await tester.pumpAndSettle();
      expect(repo.calls.length, 1);
      expect(repo.calls.single.uid, 'me');
      final until = repo.calls.single.dnd!['until']! as int;
      expect(until, inInclusiveRange(before + Duration.millisecondsPerHour, before + Duration.millisecondsPerHour + 10000));
      expect(find.text('4 hours'), findsNothing, reason: 'closed');
    });

    testWidgets('"until I turn it off" writes a null end', (tester) async {
      final repo = await pumpRow(tester);
      await openSheet(tester);
      await tester.tap(find.text('Until I turn it off'));
      await tester.pumpAndSettle();
      expect(repo.calls.single.dnd, {'until': null});
    });

    testWidgets('each choice writes its own end', (tester) async {
      final ends = <String, int?>{};
      for (final entry in {
        '30 minutes': Duration.millisecondsPerMinute * 30,
        '4 hours': Duration.millisecondsPerHour * 4,
      }.entries) {
        final t0 = DateTime.now().millisecondsSinceEpoch;
        final repo = await pumpRow(tester);
        await openSheet(tester);
        await tester.tap(find.text(entry.key));
        await tester.pumpAndSettle();
        ends[entry.key] = repo.calls.single.dnd!['until'] as int?;
        expect(ends[entry.key]!, inInclusiveRange(t0 + entry.value, t0 + entry.value + 10000), reason: entry.key);
      }
    });

    testWidgets('the morning choice writes a time that is 8:00 and in the future', (tester) async {
      final repo = await pumpRow(tester);
      await openSheet(tester);
      await tester.tap(find.text('Until 8:00 in the morning'));
      await tester.pumpAndSettle();
      final until = repo.calls.single.dnd!['until']! as int;
      final t = DateTime.fromMillisecondsSinceEpoch(until);
      expect(t.hour, 8);
      expect(t.minute, 0);
      expect(until, greaterThan(DateTime.now().millisecondsSinceEpoch));
    });

    testWidgets('while a write is going the other choices do nothing, and a second tap does not write twice', (tester) async {
      final repo = await pumpRow(tester);
      repo.hold = Completer<void>();
      await openSheet(tester);
      await tester.tap(find.text('1 hour'));
      await tester.pump();
      await tester.tap(find.text('4 hours'));
      await tester.tap(find.text('1 hour'));
      await tester.pump();
      repo.hold!.complete();
      await tester.pumpAndSettle();
      expect(repo.calls.length, 1, reason: 'one write, not three');
    });

    testWidgets('while a write is going every choice looks disabled, and the code refuses a tap that gets through anyway', (tester) async {
      final repo = await pumpRow(tester);
      repo.hold = Completer<void>();
      await openSheet(tester);
      // Only the sheet's choices: the row behind it is a ListTile too.
      List<ListTile> tiles() => tester
          .widgetList<ListTile>(find.descendant(of: find.byType(DndSheet), matching: find.byType(ListTile)))
          .toList();
      expect(tiles().length, 5);
      expect(tiles().every((t) => t.enabled), isTrue, reason: 'before: all enabled');
      await tester.tap(find.text('1 hour'));
      await tester.pump();
      expect(tiles().every((t) => !t.enabled), isTrue, reason: 'during: all disabled');
      for (final t in tiles()) {
        t.onTap!(); // as if the tap got past the disabled look
      }
      await tester.pump();
      repo.hold!.complete();
      await tester.pumpAndSettle();
      expect(repo.calls.length, 1, reason: 'still just the one write');
    });

    testWidgets('a failure shows, keeps the sheet open, and the choices work again', (tester) async {
      final repo = await pumpRow(tester);
      repo.failWith = Exception('offline');
      await openSheet(tester);
      await tester.tap(find.text('1 hour'));
      await tester.pumpAndSettle();
      expect(find.text("Couldn't turn it on. Try again."), findsOneWidget);
      expect(find.text('4 hours'), findsOneWidget, reason: 'still open');
      repo.failWith = null;
      await tester.tap(find.text('4 hours'));
      await tester.pumpAndSettle();
      expect(repo.calls.length, 1);
      expect(find.text("Couldn't turn it on. Try again."), findsNothing);
      expect(find.text('4 hours'), findsNothing, reason: 'closed on success');
    });
  });

  group('the red dot on your avatar in the app bar', () {
    Badge badge(WidgetTester tester) => tester.widget<Badge>(find.byType(Badge));

    testWidgets('on while it is on, with the tooltip saying so', (tester) async {
      await pump(tester, const ProfileAvatarButton(), dnd: const Dnd());
      expect(badge(tester).isLabelVisible, isTrue);
      expect(badge(tester).backgroundColor, Palette.bad);
      expect(find.byTooltip('You (do not disturb is on)'), findsOneWidget);
    });

    testWidgets('off when it is off, or has run out', (tester) async {
      await pump(tester, const ProfileAvatarButton());
      expect(badge(tester).isLabelVisible, isFalse);
      expect(find.byTooltip('You'), findsOneWidget);
      await pump(tester, const ProfileAvatarButton(), dnd: Dnd(until: _in(const Duration(seconds: -1))));
      expect(badge(tester).isLabelVisible, isFalse);
    });

    testWidgets('on while it still has time left', (tester) async {
      await pump(tester, const ProfileAvatarButton(), dnd: Dnd(until: _in(const Duration(hours: 1))));
      expect(badge(tester).isLabelVisible, isTrue);
    });
  });

  group('the ping', () {
    bool due({bool quiet = false, int? last, int stamp = 5, bool front = true, bool viewing = false}) => dmPingDue(
      lastPingedStamp: last,
      stamp: stamp,
      appInFront: front,
      viewingThisConversation: viewing,
      quiet: quiet,
    );

    test('plays as before when it is not on', () {
      expect(due(), isTrue);
      expect(due(last: 5), isFalse);
      expect(due(front: false), isFalse);
      expect(due(viewing: true), isFalse);
    });

    test('does not play while it is on, whatever else is true', () {
      for (final front in [true, false]) {
        for (final viewing in [true, false]) {
          for (final last in [null, 5, 4]) {
            expect(due(quiet: true, front: front, viewing: viewing, last: last), isFalse);
          }
        }
      }
    });
  });

  group('pins (the listener, the sheet and Firestore cannot run in a widget test)', () {
    String read(String f) => File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test('the listener reads it from the live profile at the moment a message arrives', () {
      final s = read('lib/services/notification_listener_service.dart');
      expect(
        s.contains(
          '  bool get _quiet =>\n      activeDndOf(_ref.read(profileProvider).valueOrNull, DateTime.now()) != null;',
        ),
        isTrue,
      );
      expect(s.contains("import '../utils/dnd.dart';"), isTrue);
    });

    test('a DM\'s ping is silenced through the rule, and the stamp is still recorded', () {
      final s = read('lib/services/notification_listener_service.dart');
      expect(s.contains('      viewingThisConversation: _isOnScreen(path),\n      quiet: _quiet,\n    );'), isTrue);
      expect(s.contains('    _pingedAt[docId] = stamp;\n    if (due) _ref.read(sfxServiceProvider).play(Sfx.dmPing);'), isTrue);
    });

    test('a system notification (a DM or an @mention) is dropped while it is on, after being recorded as seen', () {
      final s = read('lib/services/notification_listener_service.dart');
      final fire = s.substring(s.indexOf('  void _fire({'), s.indexOf('  static const _maxBodyLen'));
      expect(fire.contains('    _lastFired[key] = dedupeValue;\n    if (_quiet) return;\n'), isTrue);
      expect(fire.indexOf('_lastFired[key] = dedupeValue;'), lessThan(fire.indexOf('if (_quiet) return;')));
      expect(fire.indexOf('if (_quiet) return;'), lessThan(fire.indexOf('_plugin.show(')));
      expect(
        RegExp(r'_fire\(').allMatches(s).length,
        3,
        reason: 'the definition and the two callers (a DM and a mention), all of which go through it',
      );
    });

    test('the profile sheet has the row, and the avatar button has the badge', () {
      final s = read('lib/widgets/shared/profile_sheet.dart');
      expect(s.contains('          const StatusRow(),\n'), isTrue);
      expect(s.contains('          const DndRow(),\n'), isTrue);
      expect(s.indexOf('const StatusRow()'), lessThan(s.indexOf('const DndRow()')));
      expect(s.contains('final quiet = activeDndOf(profile, DateTime.now()) != null;'), isTrue);
    });

    test('the write is the web\'s: dnd on the person\'s own document, deleted to switch off', () {
      final s = read('lib/services/users_repository.dart');
      expect(
        s.contains(
          "  Future<void> setMyDnd(String uid, Map<String, Object?>? dnd) async {\n"
          "    final until = dnd?['until'];\n"
          "    await _db.collection('users').doc(uid).update({\n"
          "      'dnd': dnd == null\n"
          "          ? FieldValue.delete()\n"
          "          : {'until': until is num && until.isFinite ? until : null},\n"
          "    });",
        ),
        isTrue,
      );
    });
  });
}
