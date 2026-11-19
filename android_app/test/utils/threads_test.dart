import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/models/reply_snapshot.dart';
import 'package:punx_messenger/utils/threads.dart';

/// A message `id` replying to `to` (null: not a reply), sent at `ms` (null: still being sent).
ChatMessage msg(String id, String? to, int? ms) => ChatMessage(
  id: id,
  author: const MessageAuthor(uid: 'u', name: 'U'),
  text: 'text $id',
  replyTo: to == null
      ? null
      : ReplySnapshot(messageId: to, authorName: 'A', snippet: 's'),
  createdAt: ms == null ? null : Timestamp.fromMillisecondsSinceEpoch(ms),
);

List<String> ids(Iterable<ChatMessage> l) => l.map((m) => m.id).toList();

void main() {
  group('which message a reply belongs to', () {
    test('a reply belongs to the message it quotes', () {
      expect(replyTargetOf(msg('r', 'a', 1)), 'a');
    });

    test('not a reply, or a malformed one, belongs to nothing', () {
      expect(replyTargetOf(msg('r', null, 1)), isNull);
      expect(replyTargetOf(msg('r', '', 1)), isNull, reason: 'a quote with no id');
      // What ReplySnapshot.fromMap makes of a quote whose id is not text.
      final bad = ChatMessage(
        id: 'r',
        author: const MessageAuthor(uid: 'u', name: 'U'),
        replyTo: ReplySnapshot.fromMap({'messageId': 7, 'authorName': 'A'}),
      );
      expect(replyTargetOf(bad), isNull);
    });

    test('a message that quotes itself is not in its own thread', () {
      expect(replyTargetOf(msg('a', 'a', 1)), isNull);
      expect(replyCounts([msg('a', 'a', 1)]), isEmpty);
    });
  });

  group('how many replies a message has', () {
    test('how many direct replies each message has', () {
      final counts = replyCounts([
        msg('a', null, 1),
        msg('r1', 'a', 2),
        msg('r2', 'a', 3),
        msg('b', null, 4),
        msg('r3', 'b', 5),
      ]);
      expect(counts, {'a': 2, 'b': 1});
    });

    test('a reply to a reply is not counted for the first message: a thread is flat', () {
      final counts = replyCounts([
        msg('a', null, 1),
        msg('r1', 'a', 2),
        msg('rr', 'r1', 3),
      ]);
      expect(counts, {'a': 1, 'r1': 1});
    });

    test('no messages, or none that reply, is an empty count', () {
      expect(replyCounts(const []), isEmpty);
      expect(replyCounts([msg('a', null, 1), msg('b', null, 2)]), isEmpty);
    });

    test('a reply whose original is not loaded still counts for it (by id, not by presence)', () {
      expect(replyCounts([msg('r', 'older', 5)]), {'older': 1});
    });
  });

  group('the order of a thread', () {
    test('the replies to one message, oldest first', () {
      final list = [
        msg('r2', 'a', 300),
        msg('x', 'other', 150),
        msg('a', null, 100),
        msg('r1', 'a', 200),
      ];
      expect(ids(threadReplies(list, 'a')), ['r1', 'r2']);
    });

    test('the root is never one of its own replies (even if it quotes itself), and a message still being sent comes last', () {
      final list = [msg('a', 'a', 10), msg('late', 'a', null), msg('r1', 'a', 100)];
      expect(ids(threadReplies(list, 'a')), ['r1', 'late']);
    });

    test('the same time falls back to the id, so the order never flickers', () {
      expect(ids(sortByTime([msg('b', 'a', 5), msg('a1', 'a', 5)])), ['a1', 'b']);
    });

    test('two messages both still being sent keep a stable order too', () {
      expect(ids(sortByTime([msg('b', 'a', null), msg('a1', 'a', null)])), ['a1', 'b']);
    });

    test('by time, not by id', () {
      expect(ids(sortByTime([msg('a', 'r', 200), msg('z', 'r', 100)])), ['z', 'a']);
      expect(ids(sortByTime([msg('a', 'r', 900), msg('b', 'r', 100)])), ['b', 'a']);
    });

    test('whatever order they arrive in, the order is the same: by time, not-yet-sent last', () {
      final items = [msg('c', 'r', 300), msg('a', 'r', 100), msg('p', 'r', null), msg('b', 'r', 200)];
      List<List<ChatMessage>> perms(List<ChatMessage> l) => l.length <= 1
          ? [l]
          : [
              for (var i = 0; i < l.length; i++)
                for (final rest in perms([...l.sublist(0, i), ...l.sublist(i + 1)]))
                  [l[i], ...rest],
            ];
      for (final order in perms(items)) {
        expect(ids(sortByTime(order)), ['a', 'b', 'c', 'p']);
      }
    });

    test('sorting leaves the list it was given alone', () {
      final list = [msg('b', 'r', 2), msg('a', 'r', 1)];
      sortByTime(list);
      expect(ids(list), ['b', 'a']);
    });
  });

  group('nothing to look in', () {
    test('no root is no thread, and not "every message that is not a reply"', () {
      final mixed = [msg('r', 'a', 1), msg('plain', null, 2), msg('plain2', null, 3)];
      expect(threadReplies(mixed, null), isEmpty);
      expect(threadReplies(mixed, ''), isEmpty, reason: 'no message has an empty id');
      expect(threadReplies(const [], 'a'), isEmpty);
    });
  });

  test('the words for a count', () {
    expect(replyLabel(1), '1 reply');
    expect(replyLabel(2), '2 replies');
    expect(replyLabel(0), '0 replies');
    expect(replyLabel(12), '12 replies');
  });

  test('threads are for conversations, not for My Notes', () {
    expect(threadsAllowed('dms/x/messages'), isTrue);
    expect(threadsAllowed('groups/g/channels/c/messages'), isTrue);
    expect(threadsAllowed('users/u/notes'), isFalse);
    expect(threadsAllowed(null), isFalse);
    expect(threadsAllowed(''), isFalse);
  });

  group('the message that is open', () {
    test('is shown as it is now, or as it was when the thread was opened', () {
      final opened = msg('a', null, 1);
      final edited = ChatMessage(
        id: 'a',
        author: const MessageAuthor(uid: 'u', name: 'U'),
        text: 'edited',
        createdAt: Timestamp.fromMillisecondsSinceEpoch(1),
      );
      expect(currentRoot([msg('b', null, 2), edited], opened).text, 'edited');
      expect(identical(currentRoot([msg('b', null, 2)], opened), opened), isTrue, reason: 'scrolled out of the loaded part');
      expect(identical(currentRoot(const [], opened), opened), isTrue);
    });
  });

  test('a thread reads as many replies as the web does', () {
    expect(threadReplyLimit, 200);
  });
}
