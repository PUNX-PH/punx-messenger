import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/services/user_error.dart';

FirebaseException fb(String code) =>
    FirebaseException(plugin: 'cloud_firestore', code: code);

void main() {
  group('describeError: Firebase errors', () {
    test(
      'permission denied names what you tried and what to do, with the code',
      () {
        final s = describeError(
          fb('permission-denied'),
          action: 'send that message',
        );
        expect(s, contains("You don't have permission to send that message"));
        expect(s, contains('sign out and back in'));
        expect(s, contains('ask an admin'));
        expect(s, endsWith('(permission-denied)'));
      },
    );

    test('the raw Firestore wording never reaches the person', () {
      for (final code in [
        'permission-denied',
        'unavailable',
        'not-found',
        'internal',
        'unauthenticated',
      ]) {
        final s = describeError(fb(code), action: 'do that');
        expect(s, isNot(contains('[cloud_firestore')));
        expect(s, isNot(contains('The caller does not have permission')));
      }
    });

    test('signed out', () {
      final s = describeError(
        fb('unauthenticated'),
        action: 'create the group',
      );
      expect(s, contains('signed out'));
      expect(s, contains("can't create the group"));
    });

    test('no connection or timeout, whichever way Firebase says it', () {
      for (final code in [
        'unavailable',
        'deadline-exceeded',
        'network-request-failed',
      ]) {
        final s = describeError(fb(code), action: 'save that change');
        expect(s, contains("Couldn't reach the server"), reason: code);
        expect(s, contains("couldn't save that change"), reason: code);
        expect(
          s,
          isNot(contains('admin')),
          reason: 'not an access problem: $code',
        );
      }
    });

    test('deleted underneath you', () {
      final s = describeError(fb('not-found'), action: 'revoke that link');
      expect(s, contains('no longer exists'));
      expect(s, contains('revoke that link'));
    });

    test('already exists and too many requests', () {
      expect(
        describeError(fb('already-exists'), action: 'add that emoji'),
        contains('already exists'),
      );
      expect(
        describeError(fb('resource-exhausted'), action: 'send that message'),
        contains('Wait a moment'),
      );
    });

    test('anything else is generic but still says what you were doing', () {
      final s = describeError(fb('internal'), action: 'create the group');
      expect(s, startsWith("Couldn't create the group."));
      expect(s, endsWith('(internal)'));
    });

    test('a Firebase error with no code has no empty brackets', () {
      final s = describeError(
        FirebaseException(plugin: 'cloud_firestore', code: ''),
        action: 'do that',
      );
      expect(s, "Couldn't do that.");
    });

    test('the three kinds of failure get three different sentences', () {
      final sentences = {
        for (final c in ['permission-denied', 'unavailable', 'not-found'])
          describeError(fb(c), action: 'x'),
      };
      expect(sentences, hasLength(3));
    });
  });

  group('describeError: everything else', () {
    test('no connection from the network layer', () {
      for (final e in [
        const SocketException('no route'),
        TimeoutException('too slow'),
      ]) {
        expect(
          describeError(e, action: 'send that message'),
          contains("Couldn't reach the server"),
        );
      }
    });

    test(
      'the app\'s own readable messages are shown as written, without Dart\'s prefix',
      () {
        expect(
          describeError(StateError('Image must be under 10 MB.'), action: 'x'),
          'Image must be under 10 MB.',
        );
        expect(
          describeError(Exception('Use 2-32 characters.'), action: 'x'),
          'Use 2-32 characters.',
        );
        expect(
          describeError(ArgumentError('Pick a name first.'), action: 'x'),
          'Pick a name first.',
        );
        expect(
          describeError(
            const FormatException('That is not an image.'),
            action: 'x',
          ),
          'That is not an image.',
        );
      },
    );

    test('an empty message does not become an empty line', () {
      expect(
        describeError(StateError(''), action: 'x'),
        'Something went wrong.',
      );
    });

    test(
      'an error that is not for a person to read becomes a plain sentence',
      () {
        for (final e in [
          Object(),
          'a bare string',
          42,
          UnimplementedError('x'),
          RangeError('index out of range'),
        ]) {
          expect(
            describeError(e, action: 'create the group'),
            "Couldn't create the group.",
          );
        }
      },
    );

    test('an ArgumentError without a text message is not shown raw', () {
      expect(
        describeError(ArgumentError.value(5, 'age'), action: 'do that'),
        isNot(contains('Invalid argument')),
      );
    });
  });
}
