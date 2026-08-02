import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/markdown/mention_resolver.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';

UserProfile _user(String id, String name) => UserProfile(
  id: id,
  email: '$name@punx.ai',
  name: name,
  role: Role.employee,
);

void main() {
  group('extractMentionedUids', () {
    test('collects unique uids from <@uid> tokens', () {
      expect(
        extractMentionedUids('hi <@abc123> and <@def456> and <@abc123> again'),
        unorderedEquals(['abc123', 'def456']),
      );
    });

    test('empty/null text yields no uids', () {
      expect(extractMentionedUids(''), isEmpty);
      expect(extractMentionedUids(null), isEmpty);
    });
  });

  group('mentionsUid', () {
    test('true only when the exact token is present', () {
      expect(mentionsUid('hi <@abc123>', 'abc123'), isTrue);
      expect(mentionsUid('hi <@abc1234>', 'abc123'), isFalse);
    });
  });

  group('resolveMentions', () {
    test('hint map picks win over name-matching fallback', () {
      final users = [_user('u1', 'Al'), _user('u2', 'Alice')];
      final out = resolveMentions('hey @Alice', users, {'@Alice': 'u1'});
      expect(out, 'hey <@u1>');
    });

    test('falls back to exact name match, longest name first', () {
      final users = [_user('u1', 'Al'), _user('u2', 'Alice')];
      final out = resolveMentions('hey @Alice, is @Al around?', users);
      expect(out, 'hey <@u2>, is <@u1> around?');
    });

    test('does not match a name embedded inside a longer word', () {
      final users = [_user('u1', 'Al')];
      final out = resolveMentions('emailing @Alice today', users);
      expect(out, 'emailing @Alice today');
    });
  });
}
