import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/services/users_identity.dart';
import 'package:punx_messenger/utils/seen.dart';

Timestamp _ts(int ms) => Timestamp.fromMillisecondsSinceEpoch(ms);
DateTime _at(int h, [int m = 0, int day = 13]) => DateTime(2026, 11, day, h, m);
int _ms(DateTime d) => d.millisecondsSinceEpoch;

ChatMessage _msg(String id, String uid, int? ms) => ChatMessage(
  id: id,
  author: MessageAuthor(uid: uid, name: uid),
  text: 'text $id',
  createdAt: ms == null ? null : _ts(ms),
);

String _t12(DateTime t) {
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$h:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}';
}

String _t24(DateTime t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

void main() {
  group('which paths', () {
    test('only a direct message conversation counts, with or without /messages', () {
      for (final p in ['dms/a__b', 'dms/a__b/messages', 'dms/x']) {
        expect(isDmPath(p), isTrue, reason: p);
      }
      for (final p in [
        'groups/g/channels/c', 'groups/g/channels/c/messages', 'users/me/notes', 'dms/', 'dms',
        'dms/a/b', 'dms/a/messages/m1', 'xdms/a', 'groups/g', 'groups/g/messages', 'users/me', '',
      ]) {
        expect(isDmPath(p), isFalse, reason: p);
      }
      expect(isDmPath(null), isFalse);
    });
  });

  group('reading the other person\'s receipt', () {
    test('a server time, or a plain number, is the time they last had it open', () {
      expect(seenAtOf(_ts(5000)), 5000);
      expect(seenAtOf(5000), 5000);
      expect(seenAtOf(5000.0), 5000);
      expect(seenAtOf(1.9e12), 1900000000000);
    });

    test('nothing, or nonsense, is "never"', () {
      for (final bad in <Object?>[
        null, 0, -5, double.nan, double.infinity, 'soon', '5000', true, <String, Object?>{}, <Object?>[],
        _ts(0), Timestamp.fromMillisecondsSinceEpoch(-3),
      ]) {
        expect(seenAtOf(bad), isNull, reason: '$bad');
      }
    });

    test('from a whole profile: the entry for that conversation only', () {
      final data = {
        'seen': {'dms__a__b': _ts(5000), 'dms__a__c': _ts(9000)},
      };
      expect(seenAtFromProfile(data, 'dms__a__b'), 5000);
      expect(seenAtFromProfile(data, 'dms__a__c'), 9000);
      expect(seenAtFromProfile(data, 'dms__a__d'), isNull);
    });

    test('a profile with no usable `seen` has none', () {
      for (final bad in <Map<String, dynamic>?>[
        null, {}, {'seen': null}, {'seen': 'x'}, {'seen': 5}, {'seen': <Object?>[]}, {'seen': true},
        {'seen': {'dms__a__b': null}}, {'seen': {'dms__a__b': 'soon'}},
      ]) {
        expect(seenAtFromProfile(bad, 'dms__a__b'), isNull, reason: '$bad');
      }
    });
  });

  group('when a receipt is due', () {
    bool due({
      String path = 'dms/a__b',
      Timestamp? newest,
      Timestamp? seen,
      bool share = true,
      bool visible = true,
    }) => shouldRecordSeen(
      containerPath: path,
      newestCreatedAt: newest ?? _ts(1000),
      seen: seen ?? _ts(500),
      share: share,
      visible: visible,
    );

    test('something new, in a DM, sharing, app in front: yes', () {
      expect(due(), isTrue);
    });

    test('nothing new since the last receipt: no', () {
      expect(due(seen: _ts(1000)), isFalse);
      expect(due(seen: _ts(2000)), isFalse);
    });

    test('never when you do not share, never for a channel or notes', () {
      expect(due(share: false), isFalse);
      expect(due(path: 'groups/g/channels/c'), isFalse);
      expect(due(path: 'users/me/notes'), isFalse);
    });

    test('never while the app is not in front: a chat left open in a pocket has not been read', () {
      expect(due(visible: false), isFalse);
    });

    test('a conversation never opened, or a newest message still being sent, counts as new', () {
      expect(
        shouldRecordSeen(containerPath: 'dms/a__b', newestCreatedAt: _ts(1000), seen: null, share: true, visible: true),
        isTrue,
      );
      expect(
        shouldRecordSeen(containerPath: 'dms/a__b', newestCreatedAt: null, seen: _ts(9e12.toInt()), share: true, visible: true),
        isTrue,
      );
    });

    test('needsMark follows the web\'s needsMarkRead', () {
      expect(needsMark(_ts(1000), _ts(999)), isTrue);
      expect(needsMark(_ts(1000), _ts(1000)), isFalse);
      expect(needsMark(_ts(1000), null), isTrue);
      expect(needsMark(null, _ts(1000)), isTrue);
      expect(needsMark(_ts(0), _ts(1000)), isTrue);
    });
  });

  group('where the line goes', () {
    test('under your latest message sent before they last had the chat open', () {
      final list = [_msg('m1', 'me', 100), _msg('m2', 'them', 200), _msg('m3', 'me', 300)];
      expect(seenMarker(list, 'me', 350), (id: 'm3', at: 350));
    });

    test('a newer message of yours they have not seen is skipped: the line stays on the last one they did', () {
      final list = [_msg('m1', 'me', 100), _msg('m2', 'me', 200), _msg('m3', 'me', 500)];
      expect(seenMarker(list, 'me', 250), (id: 'm2', at: 250));
    });

    test('at the very moment it counts; a moment before it does not', () {
      final list = [_msg('m1', 'me', 100)];
      expect(seenMarker(list, 'me', 100), (id: 'm1', at: 100));
      expect(seenMarker(list, 'me', 99), isNull);
    });

    test('their messages are never marked, and with nothing from you there is nothing', () {
      expect(seenMarker([_msg('m1', 'them', 100), _msg('m2', 'them', 200)], 'me', 900), isNull);
      expect(seenMarker([], 'me', 900), isNull);
    });

    test('a message of yours still being sent is not seen, and does not hide an earlier one that was', () {
      expect(seenMarker([_msg('m1', 'me', null)], 'me', 900), isNull);
      expect(seenMarker([_msg('m1', 'me', 100), _msg('m2', 'me', null)], 'me', 900), (id: 'm1', at: 900));
    });

    test('nothing without a receipt or a person', () {
      final list = [_msg('m1', 'me', 100)];
      expect(seenMarker(list, 'me', null), isNull);
      expect(seenMarker(list, null, 900), isNull);
      expect(seenMarker(list, '', 900), isNull);
      // An empty id is nobody, even next to a message whose author has an empty id.
      expect(seenMarker([_msg('m9', '', 100)], '', 900), isNull);
    });
  });

  group('how it reads', () {
    test('today: just the time, in the phone\'s clock', () {
      final now = _at(18);
      expect(seenLabel(_ms(_at(15, 41)), now, _t12), 'Seen 3:41 PM');
      expect(seenLabel(_ms(_at(15, 41)), now, _t24), 'Seen 15:41');
    });

    test('another day: the date as well', () {
      final now = _at(9);
      expect(seenLabel(_ms(_at(15, 41, 12)), now, _t12), 'Seen Nov 12, 3:41 PM');
      expect(seenLabel(_ms(DateTime(2026, 10, 31, 8, 5)), now, _t24), 'Seen Oct 31, 08:05');
    });

    test('the same date in another month or year is not today', () {
      final now = _at(9);
      expect(seenLabel(_ms(DateTime(2026, 10, 13, 8, 5)), now, _t24), 'Seen Oct 13, 08:05');
      expect(seenLabel(_ms(DateTime(2026, 12, 13, 8, 5)), now, _t24), 'Seen Dec 13, 08:05');
      expect(seenLabel(_ms(DateTime(2025, 11, 13, 8, 5)), now, _t24), 'Seen Nov 13, 08:05');
    });

    test('just after midnight, the evening before is yesterday', () {
      expect(seenLabel(_ms(DateTime(2026, 11, 12, 23, 59)), DateTime(2026, 11, 13, 0, 1), _t24), 'Seen Nov 12, 23:59');
    });

    test('no usable time, no line', () {
      expect(seenLabel(0, _at(9), _t12), '');
      expect(seenLabel(-3, _at(9), _t12), '');
    });
  });

  group('on a profile', () {
    UserProfile profile(Map<String, dynamic> data) => UserProfile.fromMap('me', {'name': 'Me', 'email': 'm@x.test', ...data});

    test('your receipts are the entries that are real times', () {
      final p = profile({
        'seen': {'dms__a__b': _ts(5000), 'bad': 'x', 'worse': 7, 'nul': null},
      });
      expect(p.seen.keys.toList(), ['dms__a__b']);
      expect(p.seen['dms__a__b'], _ts(5000));
    });

    test('a `seen` that is not a map is none', () {
      for (final bad in <Object?>[null, 'x', 5, <Object?>[], true]) {
        expect(profile({'seen': bad}).seen, isEmpty, reason: '$bad');
      }
    });

    test('sharing is on unless it is explicitly switched off', () {
      expect(profile({}).shareSeen, isTrue);
      expect(profile({'prefs': <String, dynamic>{}}).shareSeen, isTrue);
      expect(profile({'prefs': {'shareSeen': true}}).shareSeen, isTrue);
      expect(profile({'prefs': {'shareSeen': false}}).shareSeen, isFalse);
      for (final v in <Object?>['no', 0, 1, null, <Object?>[]]) {
        expect(profile({'prefs': {'shareSeen': v}}).shareSeen, isTrue, reason: '$v');
      }
      for (final bad in <Object?>['x', 5, <Object?>[], null, true]) {
        expect(profile({'prefs': bad}).shareSeen, isTrue, reason: '$bad');
      }
    });

    test('both are yours alone: the shared identity carries neither', () {
      final me = UserProfile(
        id: 'o', email: 'o@x', name: 'O', role: Role.employee,
        seen: {'dms__a__b': _ts(5)}, shareSeen: false,
      );
      final shared = identityOf(me);
      expect(shared.seen, isEmpty);
      expect(shared.shareSeen, isTrue, reason: 'the default, not a frozen copy of yours');
      expect(
        identityKey(me),
        identityKey(UserProfile(id: 'o', email: 'o@x', name: 'O', role: Role.employee)),
        reason: 'nobody redraws when you open a chat',
      );
    });
  });
}
