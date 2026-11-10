import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/services/dm_open_error.dart';

DmOpenException failed(
  DmOpenStep step,
  String code, {
  String? convoId = 'a__b',
}) => DmOpenException(
  step: step,
  convoId: convoId,
  cause: FirebaseException(plugin: 'cloud_firestore', code: code),
);

void main() {
  group('describeDmOpenError', () {
    test(
      'a refused read of the other person\'s profile points at the account',
      () {
        final p = describeDmOpenError(
          failed(DmOpenStep.readProfile, 'permission-denied'),
        );
        expect(p.message, contains('sign out and back in'));
        expect(p.message, contains('profile'));
        expect(p.details, contains("reading the other person's profile"));
        expect(p.details, contains('Code: permission-denied'));
      },
    );

    test(
      'a refused look for the conversation says one exists that does not list you, and gives its id',
      () {
        final p = describeDmOpenError(
          failed(
            DmOpenStep.checkConversation,
            'permission-denied',
            convoId: 'ben__cat',
          ),
        );
        expect(p.message, contains('already exists'));
        expect(p.message, contains('does not list you'));
        expect(p.details, contains('Conversation: ben__cat'));
        expect(p.details, contains('looking for the conversation'));
      },
    );

    test('a refused creation is its own message', () {
      final p = describeDmOpenError(
        failed(DmOpenStep.createConversation, 'permission-denied'),
      );
      expect(p.message, contains('refused to start'));
      expect(p.details, contains('creating the conversation'));
    });

    test('the three steps never get the same words', () {
      final messages = {
        for (final s in DmOpenStep.values)
          describeDmOpenError(failed(s, 'permission-denied')).message,
      };
      expect(messages, hasLength(3));
    });

    test('no network says so, for any step, and is not blamed on access', () {
      for (final step in DmOpenStep.values) {
        for (final code in ['unavailable', 'deadline-exceeded']) {
          final p = describeDmOpenError(failed(step, code));
          expect(p.message, contains('reach the server'));
          expect(p.message, isNot(contains('admin')));
        }
      }
    });

    test('any other failure is generic but still names the step and code', () {
      final p = describeDmOpenError(
        failed(DmOpenStep.createConversation, 'internal'),
      );
      expect(p.message, "Couldn't open this conversation.");
      expect(p.details, contains('Code: internal'));
    });

    test('a failure that is not a Firebase error has no code line', () {
      final p = describeDmOpenError(
        const DmOpenException(step: DmOpenStep.readProfile, cause: 'boom'),
      );
      expect(p.details, isNot(contains('Code:')));
      expect(p.details, isNot(contains('Conversation:')));
    });

    test(
      'an error from outside the three steps is shown as it is, without "Bad state:"',
      () {
        final p = describeDmOpenError(
          StateError("That teammate doesn't exist."),
        );
        expect(p.message, "That teammate doesn't exist.");
        expect(p.details, '');
      },
    );

    test('the exception reports its code and step', () {
      final e = failed(DmOpenStep.checkConversation, 'permission-denied');
      expect(e.code, 'permission-denied');
      expect(e.step, DmOpenStep.checkConversation);
      expect('$e', contains('checkConversation'));
    });
  });
}
