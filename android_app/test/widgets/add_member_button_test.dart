import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/channel.dart';
import 'package:punx_messenger/models/group.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/groups_providers.dart';
import 'package:punx_messenger/providers/users_providers.dart';
import 'package:punx_messenger/screens/groups/channel_list_screen.dart';
import 'package:punx_messenger/services/groups_repository.dart';

/// Records what the screen asks for instead of touching Firestore.
class _FakeGroupsRepository implements GroupsRepository {
  final added = <({String groupId, String uid})>[];
  Object? failWith;

  @override
  Future<void> addMember(String groupId, String uid) async {
    if (failWith != null) throw failWith!;
    added.add((groupId: groupId, uid: uid));
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _group = Group(
  id: 'g1',
  name: 'Team',
  ownerUid: 'owner',
  adminUids: ['owner', 'admin1'],
  memberUids: ['owner', 'admin1', 'member1'],
);

UserProfile _u(String id, Role role, {String? name}) =>
    UserProfile(id: id, email: '$id@punx.ai', name: name ?? id, role: role);

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<_FakeGroupsRepository> pump(
    WidgetTester tester, {
    required UserProfile me,
    Group group = _group,
    List<UserProfile>? people,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final repo = _FakeGroupsRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          groupsRepositoryProvider.overrideWithValue(repo),
          groupProvider('g1').overrideWith((ref) => Stream.value(group)),
          profileProvider.overrideWith((ref) => Stream.value(me)),
          channelsProvider(
            'g1',
          ).overrideWith((ref) => Stream.value(const <Channel>[])),
          activeUsersProvider.overrideWithValue(
            people ??
                [
                  _u('owner', Role.employee),
                  _u('member1', Role.employee),
                  _u('zed', Role.employee, name: 'Zed Cruz'),
                  _u('ana', Role.employee, name: 'Ana Reyes'),
                ],
          ),
        ],
        child: const MaterialApp(home: ChannelListScreen(groupId: 'g1')),
      ),
    );
    await tester.pumpAndSettle();
    return repo;
  }

  final addButton = find.byTooltip('Add member');

  testWidgets('the owner sees the button', (tester) async {
    await pump(tester, me: _u('owner', Role.employee));
    expect(addButton, findsOneWidget);
  });

  testWidgets('a group admin sees the button', (tester) async {
    await pump(tester, me: _u('admin1', Role.employee));
    expect(addButton, findsOneWidget);
  });

  testWidgets('a workspace admin sees it, even from outside the group', (
    tester,
  ) async {
    await pump(tester, me: _u('boss', Role.admin));
    expect(addButton, findsOneWidget);
  });

  testWidgets('a plain member does not', (tester) async {
    await pump(tester, me: _u('member1', Role.employee));
    expect(addButton, findsNothing);
  });

  testWidgets('tapping it lists only people not in the group, by name', (
    tester,
  ) async {
    await pump(tester, me: _u('owner', Role.employee));
    await tester.tap(addButton);
    await tester.pumpAndSettle();
    expect(find.text('Ana Reyes'), findsOneWidget);
    expect(find.text('Zed Cruz'), findsOneWidget);
    expect(find.text('member1'), findsNothing);
    // Alphabetical: Ana is above Zed.
    expect(
      tester.getTopLeft(find.text('Ana Reyes')).dy,
      lessThan(tester.getTopLeft(find.text('Zed Cruz')).dy),
    );
  });

  testWidgets(
    'picking someone adds exactly them, closes the list, and says so',
    (tester) async {
      final repo = await pump(tester, me: _u('owner', Role.employee));
      await tester.tap(addButton);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ana Reyes'));
      await tester.pumpAndSettle();
      expect(repo.added, [(groupId: 'g1', uid: 'ana')]);
      expect(find.text('Zed Cruz'), findsNothing, reason: 'the sheet closed');
      expect(find.text('Added Ana Reyes to Team'), findsOneWidget);
    },
  );

  testWidgets('when adding fails it says so instead of staying silent', (
    tester,
  ) async {
    final repo = await pump(tester, me: _u('owner', Role.employee));
    repo.failWith = FirebaseException(
      plugin: 'cloud_firestore',
      code: 'permission-denied',
    );
    await tester.tap(addButton);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Zed Cruz'));
    await tester.pumpAndSettle();
    expect(repo.added, isEmpty);
    expect(find.textContaining('Added'), findsNothing);
    expect(find.byType(SnackBar), findsOneWidget);
    expect(
      find.textContaining("You don't have permission to add that person"),
      findsOneWidget,
    );
  });

  testWidgets('when everyone is already in, the list says so', (tester) async {
    await pump(
      tester,
      me: _u('owner', Role.employee),
      people: [_u('owner', Role.employee), _u('member1', Role.employee)],
    );
    await tester.tap(addButton);
    await tester.pumpAndSettle();
    expect(find.text('Everyone is already in this group.'), findsOneWidget);
  });

  test(
    'the group settings screen adds through the same sheet, and still adds',
    () {
      final src = File(
        'lib/screens/groups/group_settings_screen.dart',
      ).readAsStringSync().replaceAll('\r\n', '\n');
      expect(src, contains('showAddMemberSheet('));
      expect(
        src,
        matches(
          RegExp(
            r'onAdd:\s*\(u\)\s*=>\s*onWrap\(\(\)\s*=>\s*repo\.addMember\(group\.id,\s*u\.id\)\)',
          ),
        ),
      );
    },
  );
}
