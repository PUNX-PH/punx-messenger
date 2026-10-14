import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/message.dart';

void main() {
  group('ChatMessage.fromMap', () {
    test('reads a well-formed message', () {
      final ts = Timestamp.fromDate(DateTime(2026, 10, 14, 9));
      final m = ChatMessage.fromMap('m1', {
        'text': 'hello',
        'author': {'uid': 'u1', 'name': 'Ana', 'photoURL': 'https://x/y.png'},
        'mentionedUids': ['u2'],
        'createdAt': ts,
        'pinned': true,
        'reactions': {
          ':+1:': ['u2', 'u3'],
        },
      });
      expect(m.text, 'hello');
      expect(m.author.name, 'Ana');
      expect(m.mentionedUids, ['u2']);
      expect(m.createdAt, ts);
      expect(m.pinned, isTrue);
      expect(m.reactions[':+1:'], ['u2', 'u3']);
    });

    // The web client blanked the whole app on one of these. A bad field must
    // degrade, never throw: this runs inside the snapshot stream's map, so an
    // exception takes down every message in the chat, not just this one.
    test('a message with garbage in every field does not throw', () {
      late ChatMessage m;
      expect(
        () => m = ChatMessage.fromMap('bad', {
          'text': 42,
          'imageURL': ['not', 'a', 'string'],
          'imageMeta': 'nope',
          'author': 'nobody',
          'mentionedUids': 'u1',
          'replyTo': 7,
          'createdAt': 'yesterday',
          'pinned': 'yes',
          'editedAt': 1,
          'reactions': {
            'ok': 'not-a-list',
            3: ['x'],
            ':fire:': ['u1', 99, null],
          },
        }),
        returnsNormally,
      );
      expect(m.text, '');
      expect(m.imageURL, isNull);
      expect(m.author.name, 'Unknown');
      expect(m.mentionedUids, isEmpty);
      expect(m.replyTo, isNull);
      expect(m.createdAt, isNull);
      expect(m.pinned, isFalse);
      expect(m.editedAt, isNull);
      expect(m.reactions.keys, [':fire:']);
      expect(m.reactions[':fire:'], ['u1']);
    });

    test('wrong-typed fields inside nested objects degrade too', () {
      final m = ChatMessage.fromMap('n', {
        'text': 'x',
        'author': {'uid': 5, 'name': false, 'photoURL': 1},
        'replyTo': {'messageId': 1, 'authorName': 2, 'snippet': 3},
        'imageMeta': {'width': 'wide', 'height': null, 'originalName': 9},
      });
      expect(m.author.uid, '');
      expect(m.author.name, 'Unknown');
      expect(m.author.photoURL, isNull);
      expect(m.replyTo!.messageId, '');
      expect(m.replyTo!.authorName, 'Unknown');
      expect(m.imageMeta!.width, 0);
      expect(m.imageMeta!.originalName, '');
    });
  });
}
