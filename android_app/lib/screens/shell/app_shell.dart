import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_providers.dart';
import '../../providers/calls_providers.dart';
import '../../services/notification_listener_service.dart';
import '../../services/presence_service.dart';
import '../../theme/palette.dart';
import '../../widgets/calls/call_overlay.dart';

/// Mobile redesign of the desktop 3-pane layout (rail + sidebar + chat):
/// bottom nav with DMs / Groups / [Admin] tabs, each owning its own nested
/// navigator so per-tab back-stack state survives switching tabs — the
/// direct analog of AppShell.jsx's always-mounted rail + swappable sidebar.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).valueOrNull;
    final isSuperAdmin = profile?.role.isSuperAdmin ?? false;

    final items = <BottomNavigationBarItem>[
      const BottomNavigationBarItem(
        icon: Icon(Icons.mail_outline),
        activeIcon: Icon(Icons.mail),
        label: 'DMs',
      ),
      const BottomNavigationBarItem(
        icon: Icon(Icons.groups_outlined),
        activeIcon: Icon(Icons.groups),
        label: 'Groups',
      ),
      if (isSuperAdmin)
        const BottomNavigationBarItem(
          icon: Icon(Icons.shield_outlined),
          activeIcon: Icon(Icons.shield),
          label: 'Admin',
        ),
    ];

    // Admin branch (index 2) only ever gets navigated to from the nav item
    // above, which is absent for non-admins — clamp defensively anyway so
    // BottomNavigationBar never sees an out-of-range currentIndex.
    final currentIndex = navigationShell.currentIndex.clamp(
      0,
      items.length - 1,
    );

    return Scaffold(
      backgroundColor: Palette.bgMain,
      body: Stack(
        children: [
          navigationShell,
          // Non-visual daemons — presence heartbeat + foreground notifications
          // + the call signaling engine.
          const PresenceHeartbeat(),
          const NotificationDaemon(),
          const CallDaemon(),
          // Visible on top of the current tab whenever a call is ringing/live.
          const CallOverlay(),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        items: items,
        currentIndex: currentIndex,
        onTap: (index) => navigationShell.goBranch(
          index,
          initialLocation: index == navigationShell.currentIndex,
        ),
      ),
    );
  }
}
