import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/utils/firestore_paths.dart';

void main() {
  test('pathToReadKey replaces slashes with double underscores', () {
    expect(pathToReadKey('dms/abc'), 'dms__abc');
    expect(
      pathToReadKey('groups/gid/channels/cid'),
      'groups__gid__channels__cid',
    );
  });

  test('dmConvoId sorts uids so either party computes the same id', () {
    expect(dmConvoId('b', 'a'), 'a__b');
    expect(dmConvoId('a', 'b'), dmConvoId('b', 'a'));
  });

  test(
    'containerPathFromMessagesPath strips the trailing /messages segment',
    () {
      expect(containerPathFromMessagesPath('dms/abc/messages'), 'dms/abc');
      expect(
        containerPathFromMessagesPath('groups/g/channels/c/messages'),
        'groups/g/channels/c',
      );
    },
  );

  group('isUnread', () {
    test('false when there is no last message', () {
      expect(isUnread(null, null), isFalse);
    });

    test('true when the last message is newer than last-read', () {
      final lastMessageAt = Timestamp.fromMillisecondsSinceEpoch(2000);
      final lastReadAt = Timestamp.fromMillisecondsSinceEpoch(1000);
      expect(isUnread(lastMessageAt, lastReadAt), isTrue);
    });

    test(
      'false when last-read is at or after the last message, or never read',
      () {
        final lastMessageAt = Timestamp.fromMillisecondsSinceEpoch(1000);
        expect(
          isUnread(lastMessageAt, Timestamp.fromMillisecondsSinceEpoch(1000)),
          isFalse,
        );
        expect(
          isUnread(lastMessageAt, Timestamp.fromMillisecondsSinceEpoch(2000)),
          isFalse,
        );
        expect(
          isUnread(Timestamp.fromMillisecondsSinceEpoch(500), null),
          isTrue,
        );
      },
    );
  });
}
