import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/auth_providers.dart';
import '../screens/admin/admin_panel_screen.dart';
import '../screens/dms/dm_chat_screen.dart';
import '../screens/dms/dms_list_screen.dart';
import '../screens/groups/channel_screen.dart';
import '../screens/groups/channel_list_screen.dart';
import '../screens/groups/groups_list_screen.dart';
import '../screens/login_screen.dart';
import '../screens/notes/my_notes_screen.dart';
import '../screens/shell/app_shell.dart';
import '../widgets/shared/loading_view.dart';
import 'route_paths.dart';

/// Notifies go_router whenever the coarse-grained [authStatusProvider]
/// changes, so `redirect` re-runs on sign-in/sign-out transitions without
/// GoRouter itself being recreated (which would blow away the nav stack).
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(Ref ref) {
    _sub = ref.listen<AuthStatus>(authStatusProvider, (prev, next) {
      if (prev != next) notifyListeners();
    });
  }
  late final ProviderSubscription<AuthStatus> _sub;

  @override
  void dispose() {
    _sub.close();
    super.dispose();
  }
}

/// Created once per app lifetime — only reads/listens to auth providers,
/// never watches them, so this Provider itself never rebuilds.
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefreshNotifier(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: RoutePaths.splash,
    refreshListenable: refresh,
    redirect: (context, state) {
      final status = ref.read(authStatusProvider);
      final loc = state.matchedLocation;

      if (status == AuthStatus.signedOut) {
        return loc == RoutePaths.login ? null : RoutePaths.login;
      }
      if (status == AuthStatus.loading) {
        return loc == RoutePaths.splash ? null : RoutePaths.splash;
      }

      // AuthStatus.ready
      if (loc == RoutePaths.login || loc == RoutePaths.splash) {
        return RoutePaths.dms;
      }
      if (loc.startsWith('/admin')) {
        final isSuperAdmin =
            ref.read(profileProvider).valueOrNull?.role.isSuperAdmin ?? false;
        if (!isSuperAdmin) return RoutePaths.dms;
      }
      return null;
    },
    routes: [
      GoRoute(
        path: RoutePaths.splash,
        builder: (context, state) => const LoadingView(label: 'Signing you in'),
      ),
      GoRoute(
        path: RoutePaths.login,
        builder: (context, state) => const LoginScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          // Branch 0: DMs — list + convo + pinned My Notes entry.
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: RoutePaths.dms,
                builder: (context, state) => const DmsListScreen(),
                routes: [
                  GoRoute(
                    path: ':otherUid',
                    builder: (context, state) => DmChatScreen(
                      otherUid: state.pathParameters['otherUid']!,
                    ),
                  ),
                ],
              ),
              GoRoute(
                path: RoutePaths.myNotes,
                builder: (context, state) => const MyNotesScreen(),
              ),
            ],
          ),
          // Branch 1: Groups — list + channel list + channel chat.
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: RoutePaths.groups,
                builder: (context, state) => const GroupsListScreen(),
              ),
              GoRoute(
                path: RoutePaths.group,
                builder: (context, state) => ChannelListScreen(
                  groupId: state.pathParameters['groupId']!,
                ),
                routes: [
                  GoRoute(
                    path: 'c/:channelId',
                    // ChannelScreen, not ChannelChatScreen: a voice channel
                    // has to open into the voice room, and only the channel
                    // document says which it is.
                    builder: (context, state) => ChannelScreen(
                      groupId: state.pathParameters['groupId']!,
                      channelId: state.pathParameters['channelId']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          // Branch 2: Admin — only reachable (redirect-guarded above) and
          // shown in the bottom nav for super admins.
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: RoutePaths.admin,
                builder: (context, state) => const AdminPanelScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});
