import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/channel.dart';
import 'package:punx_messenger/models/group.dart';
import 'package:punx_messenger/models/group_invite.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/groups_providers.dart';
import 'package:punx_messenger/screens/groups/group_invites_screen.dart';
import 'package:punx_messenger/services/invites_repository.dart';

/// Records what the screen asks for instead of touching Firestore.
class _FakeInvitesRepository implements InvitesRepository {
  final created = <({List<String> channelIds, int days, String by})>[];
  final revoked = <String>[];

  @override
  Future<GroupInvite> createInvite({
    required Group group,
    required List<Channel> channels,
    required String createdBy,
    int days = 7,
  }) async {
    created.add((
      channelIds: [for (final c in channels) c.id],
      days: days,
      by: createdBy,
    ));
    return GroupInvite(token: 'newtoken', groupId: group.id);
  }

  @override
  Future<void> revokeInvite(String token) async => revoked.add(token);

  @override
  Stream<List<GroupInvite>> listenGroupInvites(String groupId) =>
      const Stream.empty();
}

const _groupId = 'g1';
const _group = Group(
  id: _groupId,
  name: 'Test',
  ownerUid: 'owner',
  adminUids: ['admin1'],
);

UserProfile _user(String id, Role role) =>
    UserProfile(id: id, email: '$id@punx.ai', name: id, role: role);

final _now = DateTime.now();
GroupInvite _invite(
  String token, {
  required List<String> names,
  Duration expiresIn = const Duration(days: 5),
  bool revoked = false,
}) => GroupInvite(
  token: token,
  groupId: _groupId,
  channelNames: names,
  channelIds: [for (final n in names) n],
  expiresAt: Timestamp.fromDate(_now.add(expiresIn)),
  createdAt: Timestamp.fromDate(_now),
  revoked: revoked,
);

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  final clipboard = <String>[];
  setUp(() {
    clipboard.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'Clipboard.setData') {
            clipboard.add((call.arguments as Map)['text'] as String);
          }
          return null;
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  Future<_FakeInvitesRepository> pump(
    WidgetTester tester, {
    UserProfile? me,
    List<Channel>? channels,
    List<GroupInvite> invites = const [],
    Size size = const Size(390, 844),
    double textScale = 1.0,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    tester.platformDispatcher.textScaleFactorTestValue = textScale;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearAllTestValues);

    final repo = _FakeInvitesRepository();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          invitesRepositoryProvider.overrideWithValue(repo),
          groupProvider(_groupId).overrideWith((ref) => Stream.value(_group)),
          profileProvider.overrideWith(
            (ref) => Stream.value(me ?? _user('admin1', Role.employee)),
          ),
          channelsProvider(_groupId).overrideWith(
            (ref) => Stream.value(
              channels ??
                  const [
                    Channel(id: 'general', name: 'general'),
                    Channel(id: 'music', name: 'music', private: true),
                    Channel(id: 'standup', name: 'standup', type: 'voice'),
                  ],
            ),
          ),
          groupInvitesProvider(
            _groupId,
          ).overrideWith((ref) => Stream.value(invites)),
        ],
        child: const MaterialApp(home: GroupInvitesScreen(groupId: _groupId)),
      ),
    );
    await tester.pumpAndSettle();
    return repo;
  }

  testWidgets('a member who is not an admin cannot make links', (tester) async {
    await pump(tester, me: _user('someone', Role.employee));
    expect(
      find.text("Only this group's admins can create invite links."),
      findsOneWidget,
    );
    expect(find.text('Create & copy link'), findsNothing);
  });

  testWidgets('a group admin gets the form; a workspace admin does too', (
    tester,
  ) async {
    await pump(tester, me: _user('admin1', Role.employee)); // in adminUids
    expect(find.text('Create & copy link'), findsOneWidget);
    await pump(tester, me: _user('boss', Role.admin)); // workspace admin
    expect(find.text('Create & copy link'), findsOneWidget);
  });

  testWidgets('lists the channels and marks the private one', (tester) async {
    await pump(tester);
    expect(find.text('general'), findsOneWidget);
    expect(find.text('music'), findsOneWidget);
    expect(find.text('Private'), findsOneWidget);
    expect(find.byIcon(Icons.volume_up), findsOneWidget); // the voice channel
  });

  testWidgets('cannot create until a channel is picked', (tester) async {
    await pump(tester);
    ElevatedButton button() => tester.widget(
      find.widgetWithText(ElevatedButton, 'Create & copy link'),
    );
    expect(button().onPressed, isNull);
    await tester.tap(find.text('general'));
    await tester.pump();
    expect(button().onPressed, isNotNull);
  });

  testWidgets('creates for the picked channels and copies the link', (
    tester,
  ) async {
    final repo = await pump(tester);
    await tester.tap(find.text('general'));
    await tester.tap(find.text('music'));
    await tester.tap(find.text('30 days'));
    await tester.pump();
    await tester.tap(find.text('Create & copy link'));
    await tester.pumpAndSettle();

    expect(repo.created, hasLength(1));
    expect(repo.created.single.channelIds, ['general', 'music']);
    expect(repo.created.single.days, 30);
    expect(repo.created.single.by, 'admin1');
    expect(clipboard.single, InvitesRepository.inviteUrl('newtoken'));
    expect(find.text('Link copied'), findsOneWidget);
    // The picks are cleared, so a second tap cannot silently reuse them.
    final button = tester.widget<ElevatedButton>(
      find.widgetWithText(ElevatedButton, 'Create & copy link'),
    );
    expect(button.onPressed, isNull);
  });

  group('existing links', () {
    testWidgets('a live link can be copied and revoked', (tester) async {
      final repo = await pump(
        tester,
        invites: [
          _invite('live-token', names: ['general', 'music']),
        ],
      );
      expect(find.text('Existing links (1)'), findsOneWidget);
      expect(find.text('#general, #music'), findsOneWidget);

      await tester.tap(find.text('Copy'));
      await tester.pump();
      expect(clipboard.single, InvitesRepository.inviteUrl('live-token'));
      expect(find.text('Copied'), findsOneWidget);
      await tester.pump(const Duration(seconds: 2)); // label resets
      expect(find.text('Copy'), findsOneWidget);

      await tester.tap(find.text('Revoke'));
      await tester.pumpAndSettle();
      // It asks first, and does nothing until told to.
      expect(find.text('Revoke this link?'), findsOneWidget);
      expect(repo.revoked, isEmpty);
      await tester.tap(find.widgetWithText(TextButton, 'Revoke').last);
      await tester.pumpAndSettle();
      expect(repo.revoked, ['live-token']);
    });

    testWidgets('cancelling the revoke dialog revokes nothing', (tester) async {
      final repo = await pump(
        tester,
        invites: [
          _invite('live-token', names: ['general']),
        ],
      );
      await tester.tap(find.text('Revoke'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(repo.revoked, isEmpty);
    });

    testWidgets('expired and revoked links are labelled and have no actions', (
      tester,
    ) async {
      await pump(
        tester,
        invites: [
          _invite(
            'old',
            names: ['general'],
            expiresIn: const Duration(days: -2),
          ),
          _invite('dead', names: ['music'], revoked: true),
        ],
      );
      expect(find.text('EXPIRED'), findsOneWidget);
      expect(find.text('REVOKED'), findsOneWidget);
      expect(find.text('Copy'), findsNothing);
      expect(find.text('Revoke'), findsNothing);
    });

    testWidgets('says so when there are none', (tester) async {
      await pump(tester);
      expect(find.text('None yet.'), findsOneWidget);
    });
  });

  // Same layout matrix as the message list: Flutter fails any test in which a
  // RenderFlex overflows, so rendering at each size is the check.
  group('fits every device', () {
    const sizes = <String, Size>{
      'small phone 320x568': Size(320, 568),
      'phone 390x844': Size(390, 844),
      'phone landscape 844x390': Size(844, 390),
      'small landscape 568x320': Size(568, 320),
      'tablet 768x1024': Size(768, 1024),
    };
    for (final entry in sizes.entries) {
      for (final scale in const [1.0, 2.0]) {
        testWidgets('${entry.key} at ${scale}x text', (tester) async {
          await pump(
            tester,
            size: entry.value,
            textScale: scale,
            invites: [
              _invite(
                'a' * 43,
                names: ['general', 'a-very-long-channel-name', 'music', 'ops'],
              ),
              _invite('b' * 43, names: ['general'], revoked: true),
              _invite(
                'c' * 43,
                names: ['music'],
                expiresIn: const Duration(days: -9),
              ),
            ],
          );
          expect(tester.takeException(), isNull);
        });
      }
    }
  });
}
