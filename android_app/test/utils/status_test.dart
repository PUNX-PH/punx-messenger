import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/custom_status.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/services/users_identity.dart';
import 'package:punx_messenger/utils/status.dart';

// Direction and control characters are built from their numbers, so this file holds none of them.
String ch(int code) => String.fromCharCode(code);

UserProfile _u({Object? status}) =>
    UserProfile.fromMap('u1', {'name': 'U', 'email': 'u@x.test', 'status': status});

final _now = DateTime(2026, 11, 15, 10, 30);

void main() {
  group('cleanStatusText', () {
    test('plain text stays as it is', () {
      expect(cleanStatusText('In a meeting'), 'In a meeting');
    });

    test('anything that is not text is nothing', () {
      for (final x in <Object?>[null, 5, true, <String>['a'], {'a': 1}]) {
        expect(cleanStatusText(x), '', reason: '$x');
      }
    });

    test('it is one line: newlines, tabs and runs of spaces become single spaces, and it is trimmed', () {
      expect(cleanStatusText('  a\n\tb   c \r\n '), 'a b c');
    });

    test('control characters become spaces', () {
      expect(cleanStatusText('a${ch(0)}b${ch(0x1F)}c${ch(0x7F)}d${ch(0x9F)}e'), 'a b c d e');
    });

    test('every text-direction mark is removed, so a status cannot flip around its neighbours', () {
      for (final code in [0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]) {
        expect(cleanStatusText('a${ch(code)}b'), 'a b', reason: code.toRadixString(16));
      }
    });

    test('characters either side of those ranges are left alone', () {
      for (final code in [0x20, 0xA0 + 1, 0x200D, 0x2010, 0x202F, 0x2065, 0x206A]) {
        expect(cleanStatusText('a${ch(code)}b').contains('b'), isTrue, reason: code.toRadixString(16));
      }
      expect(cleanStatusText('a${ch(0x200D)}b'), 'a${ch(0x200D)}b', reason: 'a joiner, used in emoji, stays');
    });

    test('at most 60 characters', () {
      expect(cleanStatusText('x' * 60), 'x' * 60);
      expect(cleanStatusText('x' * 61), 'x' * 60);
      expect(cleanStatusText('x' * 500).length, statusMax);
    });

    test('a character outside the basic plane counts as one, and is never cut in half', () {
      final out = cleanStatusText('\u{1F600}' * 61);
      expect(out.runes.length, 60);
      expect(out, '\u{1F600}' * 60);
    });

    test('cutting at 60 does not leave a space at the end', () {
      expect(cleanStatusText('${'x' * 59} yyyy'), 'x' * 59);
    });

    test('only unwanted characters leave nothing', () {
      expect(cleanStatusText('${ch(0x202E)}${ch(0x200F)}  '), '');
    });
  });

  group('CustomStatus.parse', () {
    test('text and an end time are read', () {
      final s = CustomStatus.parse({'text': 'On leave', 'until': 1800000000000})!;
      expect(s.text, 'On leave');
      expect(s.until, 1800000000000);
    });

    test('no end time is "until I change it"', () {
      expect(CustomStatus.parse({'text': 'On leave'})!.until, isNull);
      expect(CustomStatus.parse({'text': 'On leave', 'until': null})!.until, isNull);
    });

    test('an end time that is not a usable number is none, not an error', () {
      for (final u in <Object?>['soon', double.nan, double.infinity, true, <int>[]]) {
        expect(CustomStatus.parse({'text': 'a', 'until': u})!.until, isNull, reason: '$u');
      }
    });

    test('a fractional end time is kept as whole milliseconds', () {
      expect(CustomStatus.parse({'text': 'a', 'until': 1800000000000.7})!.until, 1800000000000);
    });

    test('what is not a status is none', () {
      for (final x in <Object?>[null, 'On leave', 5, <String>['On leave'], <String, Object?>{}, {'text': ''}, {'text': '   '}, {'text': 5}, {'until': 5}]) {
        expect(CustomStatus.parse(x), isNull, reason: '$x');
      }
    });

    test('the text is cleaned on the way in', () {
      expect(CustomStatus.parse({'text': '  hi${ch(0x202E)}there\n'})!.text, 'hi there');
    });
  });

  group('isActiveAt', () {
    test('no end time never ends', () {
      expect(const CustomStatus(text: 'a').isActiveAt(DateTime(2999)), isTrue);
    });

    test('it is active until its time, and not at it', () {
      final end = _now.millisecondsSinceEpoch;
      final s = CustomStatus(text: 'a', until: end);
      expect(s.isActiveAt(_now.subtract(const Duration(milliseconds: 1))), isTrue);
      expect(s.isActiveAt(_now), isFalse);
      expect(s.isActiveAt(_now.add(const Duration(seconds: 1))), isFalse);
    });
  });

  group('expiryAt', () {
    final base = _now.millisecondsSinceEpoch;
    test('hours and days run from now', () {
      expect(expiryAt('1h', _now), base + 3600000);
      expect(expiryAt('4h', _now), base + 4 * 3600000);
      expect(expiryAt('7d', _now), base + 7 * 24 * 3600000);
    });

    test('today ends at the last moment of the person\'s own day', () {
      expect(expiryAt('today', _now), DateTime(2026, 11, 15, 23, 59, 59, 999).millisecondsSinceEpoch);
      expect(expiryAt('today', DateTime(2026, 11, 15, 23, 59, 59, 999)), DateTime(2026, 11, 15, 23, 59, 59, 999).millisecondsSinceEpoch);
    });

    test('never, and anything unknown, is no end', () {
      expect(expiryAt('never', _now), isNull);
      expect(expiryAt('fortnight', _now), isNull);
      expect(expiryAt('', _now), isNull);
    });

    test('every choice offered is understood, and the list is what the web offers', () {
      expect([for (final o in expiryOptions) o.id], ['today', '1h', '4h', '7d', 'never']);
      expect([for (final o in expiryOptions) o.label], ['Today', '1 hour', '4 hours', '7 days', "Don't clear"]);
      for (final o in expiryOptions.where((o) => o.id != 'never')) {
        expect(expiryAt(o.id, _now), isNotNull, reason: o.id);
      }
    });

    test('the ready-made statuses are the web\'s', () {
      expect(statusPresets, ['In a meeting', 'On leave', 'Out sick', 'Working remotely', 'Heads down']);
      for (final p in statusPresets) {
        expect(cleanStatusText(p), p, reason: 'a preset survives cleaning');
      }
    });
  });

  group('buildStatus', () {
    test('clean text and its end', () {
      expect(buildStatus('  On leave  ', '1h', _now), {'text': 'On leave', 'until': _now.millisecondsSinceEpoch + 3600000});
      expect(buildStatus('On leave', 'never', _now), {'text': 'On leave', 'until': null});
    });

    test('nothing to say means clear it', () {
      expect(buildStatus('', 'today', _now), isNull);
      expect(buildStatus('   \n', 'today', _now), isNull);
      expect(buildStatus(ch(0x202E), 'today', _now), isNull);
    });
  });

  group('activeStatusOf', () {
    test('someone with a live status shows it', () {
      expect(activeStatusOf(_u(status: {'text': 'Out sick'}), _now)?.text, 'Out sick');
      expect(activeStatusOf(_u(status: {'text': 'x', 'until': _now.millisecondsSinceEpoch + 1}), _now)?.text, 'x');
    });

    test('nobody, nothing, or an expired one shows nothing', () {
      expect(activeStatusOf(null, _now), isNull);
      expect(activeStatusOf(_u(), _now), isNull);
      expect(activeStatusOf(_u(status: {'text': 'x', 'until': _now.millisecondsSinceEpoch}), _now), isNull);
      expect(activeStatusOf(_u(status: {'text': 'x', 'until': 5}), _now), isNull);
    });
  });

  group('the profile and the shared identity', () {
    test('the profile reads the status', () {
      expect(_u(status: {'text': 'Heads down', 'until': null}).customStatus?.text, 'Heads down');
      expect(_u().customStatus, isNull);
    });

    test('a status is part of who somebody is: kept by the identity, and a change of it is a change', () {
      final a = _u(status: {'text': 'one'});
      expect(identityOf(a).customStatus?.text, 'one');
      expect(identityKey(a), isNot(identityKey(_u(status: {'text': 'two'}))));
      expect(identityKey(a), isNot(identityKey(_u())));
      expect(identityKey(_u(status: {'text': 'one', 'until': 5})), isNot(identityKey(_u(status: {'text': 'one', 'until': 6}))));
      expect(identityKey(a), identityKey(_u(status: {'text': 'one'})));
    });

    test('and nothing else about the profile was disturbed', () {
      final p = UserProfile.fromMap('u1', {'name': 'U', 'email': 'u@x.test', 'role': 'admin'});
      expect(identityOf(p).role, Role.admin);
    });
  });
}
