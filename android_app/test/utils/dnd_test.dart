import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/dnd.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/services/users_identity.dart';
import 'package:punx_messenger/utils/dnd.dart';

const _min = Duration.millisecondsPerMinute;
const _hour = Duration.millisecondsPerHour;

DateTime _at(int h, [int m = 0, int day = 13]) => DateTime(2026, 11, day, h, m);
final _now = _at(14, 30);

UserProfile _user({Object? dnd}) =>
    UserProfile.fromMap('me', {'name': 'Me', 'email': 'm@x.test', 'dnd': dnd});

/// 12-hour, the way the sheet would write it, so the wording can be checked exactly.
String _t12(DateTime t) {
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$h:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}';
}

void main() {
  group('when it ends', () {
    test('the timed choices end that long from now', () {
      final ms = _now.millisecondsSinceEpoch;
      expect(dndUntil('30m', _now), ms + 30 * _min);
      expect(dndUntil('1h', _now), ms + _hour);
      expect(dndUntil('4h', _now), ms + 4 * _hour);
    });

    test('"until I turn it off", and anything unknown, has no end', () {
      for (final id in ['never', 'nope', '', '30M']) {
        expect(dndUntil(id, _now), isNull, reason: id);
      }
    });

    test('the morning is the next 8:00 on the person\'s own clock', () {
      expect(morningHour, 8);
      int ms(DateTime d) => d.millisecondsSinceEpoch;
      expect(dndUntil('morning', _at(14, 30)), ms(_at(8, 0, 14)), reason: 'afternoon: tomorrow');
      expect(dndUntil('morning', _at(23, 59)), ms(_at(8, 0, 14)), reason: 'late at night: tomorrow');
      expect(dndUntil('morning', _at(3)), ms(_at(8, 0, 13)), reason: 'before 8: this morning');
      expect(dndUntil('morning', _at(7, 59)), ms(_at(8, 0, 13)));
      expect(dndUntil('morning', _at(8)), ms(_at(8, 0, 14)), reason: 'at 8:00 exactly: tomorrow');
      expect(dndUntil('morning', _at(8, 1)), ms(_at(8, 0, 14)));
    });

    test('the morning rolls over the end of a month and a year', () {
      expect(
        dndUntil('morning', DateTime(2026, 11, 30, 20)),
        DateTime(2026, 12, 1, 8).millisecondsSinceEpoch,
      );
      expect(
        dndUntil('morning', DateTime(2026, 12, 31, 20)),
        DateTime(2027, 1, 1, 8).millisecondsSinceEpoch,
      );
    });

    test('what is stored for a choice is just a time or null', () {
      expect(buildDnd('1h', _now), {'until': _now.millisecondsSinceEpoch + _hour});
      expect(buildDnd('never', _now), {'until': null});
      expect(buildDnd('1h', _now).keys, ['until']);
    });

    test('the choices match the web\'s: same ids, same order, one open-ended and last', () {
      expect(dndOptions.map((o) => o.id), ['30m', '1h', '4h', 'morning', 'never']);
      expect(dndOptions.map((o) => o.label), [
        '30 minutes',
        '1 hour',
        '4 hours',
        'Until 8:00 in the morning',
        'Until I turn it off',
      ]);
      for (final o in dndOptions) {
        final until = dndUntil(o.id, _now);
        expect(until == null || until > _now.millisecondsSinceEpoch, isTrue, reason: o.id);
      }
    });
  });

  group('reading what a profile holds', () {
    test('a time in the future is on, with its end', () {
      final d = Dnd.parse({'until': _now.millisecondsSinceEpoch + 1})!;
      expect(d.until, _now.millisecondsSinceEpoch + 1);
      expect(d.isActiveAt(_now), isTrue);
    });

    test('an explicit null is on for ever', () {
      final d = Dnd.parse({'until': null})!;
      expect(d.until, isNull);
      expect(d.isActiveAt(_now), isTrue);
      expect(d.isActiveAt(DateTime(2100)), isTrue);
    });

    test('a number the database hands back as a double is read', () {
      expect(Dnd.parse({'until': 1.9e12})!.until, 1900000000000);
    });

    test('it is off at the very moment it ends, and after', () {
      final ms = _now.millisecondsSinceEpoch;
      expect(Dnd(until: ms).isActiveAt(_now), isFalse);
      expect(Dnd(until: ms - 1).isActiveAt(_now), isFalse);
      expect(Dnd(until: ms + 1).isActiveAt(_now), isTrue);
    });

    test('a field that is missing or the wrong shape is OFF, never on for ever', () {
      final bad = <Object?>[
        null, true, 'on', 5, <Object?>[], <Object?>[{'until': null}], <String, Object?>{},
        {'until2': null}, {'until': '99999999999999'}, {'until': double.nan},
        {'until': double.infinity}, {'until': double.negativeInfinity},
        {'until': <String, Object?>{}}, {'until': true}, {'until': <Object?>[]},
      ];
      for (final b in bad) {
        expect(Dnd.parse(b), isNull, reason: '$b');
      }
    });

    test('activeDndOf: on, off, run out, and nobody signed in', () {
      final ms = _now.millisecondsSinceEpoch;
      expect(activeDndOf(_user(dnd: {'until': ms + _hour}), _now)?.until, ms + _hour);
      expect(activeDndOf(_user(dnd: {'until': null}), _now), isNotNull);
      expect(activeDndOf(_user(dnd: {'until': ms - 1}), _now), isNull);
      expect(activeDndOf(_user(dnd: {'until': ms}), _now), isNull);
      expect(activeDndOf(_user(), _now), isNull);
      expect(activeDndOf(null, _now), isNull);
    });

    test('a profile carries it, and one with a broken value carries none', () {
      expect(_user(dnd: {'until': null}).dnd, isNotNull);
      expect(_user(dnd: 'junk').dnd, isNull);
      expect(_user().dnd, isNull);
    });

    test('it is private to you: the shared identity of a person does not carry it', () {
      final me = _user(dnd: {'until': null});
      expect(me.dnd, isNotNull);
      expect(identityOf(me).dnd, isNull, reason: 'not in the directory, so nobody redraws for it');
      final other = UserProfile(id: 'o', email: 'o@x', name: 'O', role: Role.employee, dnd: const Dnd());
      expect(identityKey(other), identityKey(UserProfile(id: 'o', email: 'o@x', name: 'O', role: Role.employee)));
    });
  });

  group('how it reads', () {
    test('the same day: "until 3:40 PM"', () {
      expect(dndLabel(Dnd(until: _at(15, 40).millisecondsSinceEpoch), _now, _t12), 'until 3:40 PM');
    });

    test('the next day says "tomorrow", and further away says which day', () {
      expect(
        dndLabel(Dnd(until: _at(8, 0, 14).millisecondsSinceEpoch), _now, _t12),
        'until tomorrow 8:00 AM',
      );
      expect(
        dndLabel(Dnd(until: _at(9, 0, 17).millisecondsSinceEpoch), _now, _t12),
        'until Tue, Nov 17 9:00 AM',
      );
    });

    test('tomorrow is tomorrow across the end of a month', () {
      expect(
        dndLabel(
          Dnd(until: DateTime(2026, 12, 1, 8).millisecondsSinceEpoch),
          DateTime(2026, 11, 30, 22),
          _t12,
        ),
        'until tomorrow 8:00 AM',
      );
    });

    test('the same day of ANOTHER month is not "today" or "tomorrow"', () {
      int ms(int y, int m, int d) => DateTime(y, m, d, 9).millisecondsSinceEpoch;
      expect(dndLabel(Dnd(until: ms(2026, 12, 13)), _now, _t12), 'until Sun, Dec 13 9:00 AM');
      expect(dndLabel(Dnd(until: ms(2026, 12, 14)), _now, _t12), 'until Mon, Dec 14 9:00 AM');
      expect(dndLabel(Dnd(until: ms(2027, 11, 13)), _now, _t12), 'until Sat, Nov 13 9:00 AM');
    });

    test('no end says so', () {
      expect(dndLabel(const Dnd(), _now, _t12), 'until you turn it off');
    });

    test('the time is written by what the caller passes, so a 24-hour phone reads 24-hour', () {
      expect(
        dndLabel(Dnd(until: _at(15, 40).millisecondsSinceEpoch), _now, (t) => '${t.hour}:${t.minute}'),
        'until 15:40',
      );
    });
  });
}
