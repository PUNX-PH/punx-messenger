import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/group.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/utils/add_member.dart';

const _group = Group(
  id: 'g',
  name: 'Team',
  ownerUid: 'owner',
  adminUids: ['owner', 'admin1'],
  memberUids: ['owner', 'admin1', 'member1'],
);

UserProfile _u(String id, {String? name, bool deactivated = false}) =>
    UserProfile(
      id: id,
      email: '$id@punx.ai',
      name: name ?? id,
      role: Role.employee,
      deactivated: deactivated,
    );

void main() {
  group('canAddMembers', () {
    bool can({bool admin = false, String? uid = 'x', Group? group = _group}) =>
        canAddMembers(workspaceAdmin: admin, uid: uid, group: group);

    test('the owner and the group admins can', () {
      expect(can(uid: 'owner'), isTrue);
      expect(can(uid: 'admin1'), isTrue);
    });

    test('a workspace admin can, even outside the group', () {
      expect(can(admin: true, uid: 'stranger'), isTrue);
    });

    test('a plain member, or someone outside, cannot', () {
      expect(can(uid: 'member1'), isFalse);
      expect(can(uid: 'stranger'), isFalse);
    });

    test('not before the group or the person is known', () {
      expect(can(admin: true, group: null), isFalse);
      expect(can(admin: true, uid: null), isFalse);
      expect(can(uid: 'owner', group: null), isFalse);
    });

    test('a group with no admins listed still lets its owner add', () {
      const g = Group(id: 'g', name: 'T', ownerUid: 'owner');
      expect(can(uid: 'owner', group: g), isTrue);
    });
  });

  group('addableUsers', () {
    test('only people who are not in the group yet', () {
      final out = addableUsers(_group, [
        _u('owner'),
        _u('member1'),
        _u('new1'),
        _u('new2'),
      ]);
      expect(out.map((u) => u.id), ['new1', 'new2']);
    });

    test('removed accounts are never offered', () {
      final out = addableUsers(_group, [
        _u('gone', deactivated: true),
        _u('new1'),
      ]);
      expect(out.map((u) => u.id), ['new1']);
    });

    test('by name, ignoring case', () {
      final out = addableUsers(_group, [
        _u('a', name: 'Zed'),
        _u('b', name: 'Ana'),
        _u('c', name: 'ben'),
      ]);
      expect(out.map((u) => u.name), ['Ana', 'ben', 'Zed']);
    });

    test('nobody left, or nobody given: an empty list', () {
      expect(addableUsers(_group, [_u('owner'), _u('member1')]), isEmpty);
      expect(addableUsers(_group, const []), isEmpty);
    });

    test('does not change what it was given', () {
      final input = [_u('b', name: 'B'), _u('a', name: 'A')];
      addableUsers(_group, input);
      expect(input.map((u) => u.id), ['b', 'a']);
    });
  });
}
