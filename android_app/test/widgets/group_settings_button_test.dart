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
import 'package:punx_messenger/screens/groups/group_settings_screen.dart';
import 'package:punx_messenger/services/groups_repository.dart';

/// The settings screen reads the repository; nothing here calls it.
class _FakeGroupsRepository implements GroupsRepository {
  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _group = Group(
  id: 'g1',
  name: 'Team',
  ownerUid: 'owner',
  adminUids: ['owner'],
  memberUids: ['owner', 'member1'],
);

UserProfile _u(String id) =>
    UserProfile(id: id, email: '$id@punx.ai', name: id, role: Role.employee);

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<void> pump(
    WidgetTester tester, {
    required String me,
    Group? group = _group,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final people = [_u('owner'), _u('member1')];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          groupsRepositoryProvider.overrideWithValue(_FakeGroupsRepository()),
          groupProvider('g1').overrideWith((ref) => Stream.value(group)),
          profileProvider.overrideWith((ref) => Stream.value(_u(me))),
          channelsProvider(
            'g1',
          ).overrideWith((ref) => Stream.value(const <Channel>[])),
          activeUsersProvider.overrideWithValue(people),
          usersByIdProvider.overrideWithValue({
            for (final u in people) u.id: u,
          }),
        ],
        child: const MaterialApp(home: ChannelListScreen(groupId: 'g1')),
      ),
    );
    await tester.pumpAndSettle();
  }

  final settingsButton = find.byTooltip('Group settings');

  testWidgets('every member sees the button, not only owners and admins', (
    tester,
  ) async {
    await pump(tester, me: 'member1');
    expect(settingsButton, findsOneWidget);
  });

  testWidgets('the owner sees it too, next to Add member', (tester) async {
    await pump(tester, me: 'owner');
    expect(settingsButton, findsOneWidget);
    expect(find.byTooltip('Add member'), findsOneWidget);
  });

  testWidgets('tapping it opens that group\'s settings', (tester) async {
    await pump(tester, me: 'owner');
    await tester.tap(settingsButton);
    await tester.pumpAndSettle();
    final screen = tester.widget<GroupSettingsScreen>(
      find.byType(GroupSettingsScreen),
    );
    expect(screen.groupId, 'g1');
  });

  testWidgets('not before the group is known', (tester) async {
    await pump(tester, me: 'owner', group: null);
    expect(settingsButton, findsNothing);
  });
}
