import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/utils/default_group.dart';

// The same cases as tests/onboarding.test.mjs on the web, so both apps ask in
// the same situations.
final _now = DateTime.utc(2026, 11, 13, 12);
const _day = Duration(days: 1);

Timestamp _ago(Duration d) => Timestamp.fromDate(_now.subtract(d));

bool _ask({
  Map<String, dynamic>? profile,
  String? email = 'ana@punx.ai',
  String? domain = 'punx.ai',
  bool justCreated = false,
}) => shouldJoinDefaultGroup(
  profile:
      profile ??
      {'role': 'employee', 'createdAt': _ago(const Duration(minutes: 1))},
  email: email,
  domain: domain,
  now: _now,
  justCreated: justCreated,
);

void main() {
  group('shouldJoinDefaultGroup', () {
    test('a new company account asks', () => expect(_ask(), isTrue));

    test('an account made just now asks before its creation time is known', () {
      expect(
        _ask(
          justCreated: true,
          profile: {'role': 'employee', 'createdAt': null},
        ),
        isTrue,
      );
    });

    test('an account from the last week asks again at the next sign-in', () {
      expect(
        _ask(profile: {'role': 'employee', 'createdAt': _ago(_day * 6)}),
        isTrue,
      );
    });

    test('an account older than a week does not ask', () {
      expect(
        _ask(profile: {'role': 'employee', 'createdAt': _ago(_day * 8)}),
        isFalse,
      );
      expect(_ask(profile: {'role': 'employee'}), isFalse);
    });

    test(
      'someone already marked does not ask, so a person who left stays out',
      () {
        final marked = {
          'role': 'employee',
          'createdAt': _ago(const Duration(seconds: 1)),
          'defaultGroupJoinedAt': _ago(const Duration(milliseconds: 500)),
        };
        expect(_ask(profile: marked), isFalse);
        expect(_ask(profile: marked, justCreated: true), isFalse);
      },
    );

    test('only company addresses ask', () {
      expect(_ask(email: 'perezjohnrey43@gmail.com'), isFalse);
      expect(_ask(email: 'ana@notpunx.ai'), isFalse);
      expect(_ask(email: 'ana@sub.punx.ai'), isFalse);
      expect(_ask(email: ''), isFalse);
      expect(_ask(email: null), isFalse);
      expect(_ask(email: 'x@gmail.com', justCreated: true), isFalse);
    });

    test('guests and unknown roles do not ask', () {
      for (final role in ['guest', 'overlord', null]) {
        expect(
          _ask(
            profile: {
              'role': role,
              'createdAt': _ago(const Duration(seconds: 1)),
            },
          ),
          isFalse,
          reason: '$role',
        );
      }
    });

    test('every staff role asks', () {
      for (final role in staffRoles) {
        expect(
          _ask(
            profile: {
              'role': role,
              'createdAt': _ago(const Duration(seconds: 1)),
            },
          ),
          isTrue,
          reason: role,
        );
      }
    });

    test('no profile, or a creation date far in the future, never asks', () {
      expect(
        shouldJoinDefaultGroup(
          profile: null,
          email: 'ana@punx.ai',
          domain: 'punx.ai',
          now: _now,
        ),
        isFalse,
      );
      expect(
        _ask(
          profile: {
            'role': 'employee',
            'createdAt': Timestamp.fromDate(_now.add(_day * 365)),
          },
        ),
        isFalse,
      );
    });

    test(
      'a creation time as a DateTime works; anything else is not a date',
      () {
        expect(
          _ask(
            profile: {
              'role': 'employee',
              'createdAt': _now.subtract(const Duration(seconds: 1)),
            },
          ),
          isTrue,
        );
        for (final bad in ['yesterday', 12345, <String, dynamic>{}]) {
          expect(
            _ask(profile: {'role': 'employee', 'createdAt': bad}),
            isFalse,
            reason: '$bad',
          );
        }
      },
    );
  });

  group('hasCompanyEmail', () {
    test('is exact and follows the configured domain', () {
      expect(hasCompanyEmail('Ana@PUNX.AI', 'punx.ai'), isTrue);
      expect(hasCompanyEmail('ana@punx.ai', ' Punx.AI '), isTrue);
      expect(hasCompanyEmail('ana@punx.ai', ''), isFalse);
      expect(hasCompanyEmail('ana@punx.ai', null), isFalse);
      expect(
        hasCompanyEmail('ana@', ''),
        isFalse,
        reason: 'an empty domain must not match an address ending at the @',
      );
      expect(hasCompanyEmail('@punx.ai', 'punx.ai'), isFalse);
      expect(hasCompanyEmail('ana@punx.ai.evil.com', 'punx.ai'), isFalse);
    });
  });

  group('the phone app and the Worker agree', () {
    final worker = File(
      '../workers/src/routes/onboarding.js',
    ).readAsStringSync().replaceAll('\r\n', '\n');

    test('on who counts as staff', () {
      final m = RegExp(r"STAFF_ROLES = \[([^\]]*)\]").firstMatch(worker);
      expect(m, isNotNull, reason: 'STAFF_ROLES found in the Worker');
      final roles = m!
          .group(1)!
          .split(',')
          .map((s) => s.trim().replaceAll("'", ''))
          .where((s) => s.isNotEmpty)
          .toList();
      expect(staffRoles, roles);
    });

    test('on how long an account counts as new', () {
      final m = RegExp(r'NEW_ACCOUNT_DAYS = (\d+)').firstMatch(worker);
      expect(m, isNotNull);
      expect(newAccountDays, int.parse(m!.group(1)!));
    });
  });

  group('the sign-in hook', () {
    final auth = File(
      'lib/services/auth_service.dart',
    ).readAsStringSync().replaceAll('\r\n', '\n');
    final service = File(
      'lib/services/default_group_service.dart',
    ).readAsStringSync().replaceAll('\r\n', '\n');

    test(
      'asks without waiting, with the real address and the configured domain',
      () {
        expect(auth, contains('unawaited(DefaultGroupService.request());'));
        expect(auth, contains('domain: AppConfig.allowedEmailDomain,'));
        expect(auth, contains('justCreated: isNew,'));
        expect(auth, isNot(contains('await DefaultGroupService.request(')));
      },
    );

    test('asks only after the profile has been written', () {
      expect(
        auth.indexOf('profile = {\'role\': role};'),
        lessThan(auth.indexOf('unawaited(DefaultGroupService.request());')),
      );
      expect(
        auth.indexOf('}, SetOptions(merge: true));'),
        lessThan(auth.indexOf('unawaited(DefaultGroupService.request());')),
      );
    });

    test(
      'the request is a POST with the person\'s own ID token, and never throws',
      () {
        expect(service, contains('/onboarding/join-default-group'));
        expect(service, contains('http.post('));
        expect(
          service,
          contains("'Authorization': 'Bearer \${await user.getIdToken()}'"),
        );
        expect(service, isNot(contains('body:')));
        expect(
          service,
          contains('if (user == null) return;'),
          reason: 'nobody signed in: nothing to ask',
        );
        expect(service, contains('} catch (e) {'));
      },
    );
  });
}
