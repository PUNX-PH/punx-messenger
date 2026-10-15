import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_providers.dart';
import '../../providers/calls_providers.dart';
import '../../providers/voice_channel_providers.dart';
import '../../services/notification_listener_service.dart';
import '../../services/presence_service.dart';
import '../../theme/palette.dart';
import '../../widgets/shared/sfx_daemon.dart';
import '../../widgets/calls/call_overlay.dart';
import '../../widgets/voice/voice_status_bar.dart';

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
    final immersive = ref.watch(voiceImmersiveProvider);

    // The room already shows mic, deafen and leave, so the status bar would be
    // a second set of controls for the same state sitting right below it. Only
    // when the room on screen IS the channel you are connected to: opening a
    // voice channel you have not joined leaves the bar as the one thing saying
    // where you actually are.
    final roomOnScreen = ref.watch(voiceRoomOnScreenProvider);
    final connectedTo = ref.watch(
      voiceControllerProvider.select((v) => v.active?.channelId),
    );
    final roomIsThisCall = roomOnScreen != null && roomOnScreen == connectedTo;

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

    // A side rail once there is the width for it — a tablet, or a phone held
    // sideways. Bottom navigation is right for a thumb on a portrait phone, but
    // on a wide screen it strands the tabs along the very bottom edge and burns
    // vertical space the conversation needs.
    final wide = MediaQuery.sizeOf(context).width >= _railBreakpoint;

    void select(int index) => navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
    );

    final content = Stack(
      children: [
        navigationShell,
        // Non-visual daemons — presence heartbeat + foreground notifications
        // + the call signaling engine.
        const PresenceHeartbeat(),
        const NotificationDaemon(),
        const CallDaemon(),
        const SfxDaemon(),
        // Visible on top of the current tab whenever a call is ringing/live.
        const CallOverlay(),
      ],
    );

    return Scaffold(
      backgroundColor: Palette.bgMain,
      body: wide && !immersive
          ? SafeArea(
              child: Row(
                children: [
                  NavigationRail(
                    backgroundColor: Palette.bgDark,
                    selectedIndex: currentIndex,
                    onDestinationSelected: select,
                    labelType: NavigationRailLabelType.all,
                    destinations: [
                      for (final item in items)
                        NavigationRailDestination(
                          icon: item.icon,
                          selectedIcon: item.activeIcon,
                          label: Text(item.label ?? ''),
                        ),
                    ],
                  ),
                  VerticalDivider(width: 1, color: Palette.lineSubtle),
                  Expanded(child: content),
                ],
              ),
            )
          : content,
      // Voice sits directly above the nav bar so it is present on every tab —
      // the connection outlives the screen you joined it from.
      //
      // Except in the voice room in landscape, where the room asks for the
      // whole screen ([voiceImmersiveProvider]) and this chrome would eat most
      // of the ~360 logical px of height a phone has there. The connection is
      // unaffected; only its status row is hidden, and the room carries its own
      // controls.
      bottomNavigationBar: immersive
          ? null
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!roomIsThisCall) const VoiceStatusBar(),
                if (!wide)
                  BottomNavigationBar(
                    items: items,
                    currentIndex: currentIndex,
                    onTap: select,
                  ),
              ],
            ),
    );
  }
}

/// Width from which the navigation moves to a side rail. 720dp is the usual
/// small-tablet line, and it also catches a large phone in landscape.
const _railBreakpoint = 720.0;
