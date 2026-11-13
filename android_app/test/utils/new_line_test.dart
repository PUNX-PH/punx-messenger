import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/utils/new_line.dart';

// The same cases as tests/new-line.test.mjs on the web, so both apps agree on
// where the "New" line goes.
const _ana = MessageAuthor(uid: 'ana', name: 'Ana');
final _t0 = DateTime.utc(2026, 11, 10, 9);

Timestamp _ts(int minutes) =>
    Timestamp.fromDate(_t0.add(Duration(minutes: minutes)));

ChatMessage _msg(String id, int minutes, [String uid = 'ana']) => ChatMessage(
  id: id,
  author: MessageAuthor(uid: uid, name: uid),
  text: id,
  createdAt: _ts(minutes),
);

void main() {
  group('firstUnreadId', () {
    test('goes above the first message newer than your last-read time', () {
      final list = [_msg('a', 0), _msg('b', 1), _msg('c', 2), _msg('d', 3)];
      expect(firstUnreadId(list, _ts(1), 'me'), 'c');
      expect(
        firstUnreadId(
          list,
          Timestamp.fromMillisecondsSinceEpoch(
            _t0.millisecondsSinceEpoch + 2 * 60000 - 1,
          ),
          'me',
        ),
        'c',
        reason: 'one millisecond before c',
      );
      expect(
        firstUnreadId(list, _ts(2), 'me'),
        'd',
        reason: 'a message AT the read time is read',
      );
    });

    test('nothing unread, or no last-read time at all, means no line', () {
      final list = [_msg('a', 0), _msg('b', 1)];
      expect(firstUnreadId(list, _ts(5), 'me'), isNull, reason: 'all read');
      expect(
        firstUnreadId(list, null, 'me'),
        isNull,
        reason: 'never opened: not "all new"',
      );
      expect(
        firstUnreadId(list, Timestamp.fromMillisecondsSinceEpoch(0), 'me'),
        isNull,
        reason: 'a zero read time is the same as none',
      );
      expect(firstUnreadId(const [], _ts(0), 'me'), isNull);
    });

    test('your own messages are never new to you, so the line skips them', () {
      final list = [_msg('a', 0), _msg('mine', 2, 'me'), _msg('b', 3)];
      expect(firstUnreadId(list, _ts(1), 'me'), 'b');
      expect(
        firstUnreadId([_msg('a', 0), _msg('mine', 2, 'me')], _ts(1), 'me'),
        isNull,
      );
      expect(
        firstUnreadId(list, _ts(1), null),
        'mine',
        reason: 'with no signed-in user nothing is "mine"',
      );
    });

    test('when the first loaded message is already unread there is no honest '
        'place for a line', () {
      final list = [_msg('a', 5), _msg('b', 6)];
      expect(firstUnreadId(list, _ts(0), 'me'), isNull);
    });

    test('a message still waiting for its server time is skipped', () {
      const pending = ChatMessage(id: 'p', author: _ana, text: '…');
      expect(
        firstUnreadId([_msg('a', 0), pending, _msg('b', 3)], _ts(1), 'me'),
        'b',
      );
      expect(
        firstUnreadId([_msg('a', 0), _msg('b', 1), pending], _ts(5), 'me'),
        isNull,
      );
    });
  });

  group('newLineIsAbove', () {
    test(
      'is true only when the line is completely out of sight over the top',
      () {
        expect(newLineIsAbove(-300, 100), isTrue, reason: 'well above');
        expect(newLineIsAbove(100, 100), isTrue, reason: 'bottom edge at top');
        expect(newLineIsAbove(101, 100), isFalse, reason: 'one pixel showing');
        expect(newLineIsAbove(400, 100), isFalse, reason: 'in view');
        expect(newLineIsAbove(5000, 100), isFalse, reason: 'below the view');
      },
    );

    test('anything unmeasured never offers the button', () {
      expect(newLineIsAbove(null, 100), isFalse);
      expect(newLineIsAbove(-300, null), isFalse);
      expect(newLineIsAbove(double.nan, 100), isFalse);
      expect(newLineIsAbove(-300, double.nan), isFalse);
      expect(newLineIsAbove(double.infinity, 100), isFalse);
      expect(newLineIsAbove(double.negativeInfinity, 100), isFalse);
    });
  });
}
