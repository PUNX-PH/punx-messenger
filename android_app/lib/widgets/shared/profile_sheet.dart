import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../providers/auth_providers.dart';
import '../../providers/theme_providers.dart';
import '../../providers/voice_channel_providers.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import 'avatar.dart';
import 'role_badge.dart';

/// The Android counterpart of `components/UserPanel.jsx` — your own avatar row
/// and the actions behind it.
///
/// The web renders this as a permanent bar pinned under the sidebar, which does
/// not translate: a phone has no sidebar, and the bottom of the screen already
/// carries the nav bar and the voice status row. So it is a bottom sheet opened
/// from your avatar in the app bar instead.
///
/// What is deliberately NOT copied across:
///
/// * Mic and deafen. The web keeps them here because that is where Discord puts
///   them, but on Android `VoiceStatusBar` is already on screen with mic,
///   deafen and disconnect. Duplicating them would give two controls for one
///   piece of state.
/// * The admin panel entry. It is a bottom-nav tab on Android, so it does not
///   need a menu item.
///
/// Sign out is the reason this exists: until now the app had no way out at all.
/// `signOut()` was reachable only from an admin deactivating your account.
class ProfileSheet extends ConsumerWidget {
  const ProfileSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: Palette.bgRaised,
      showDragHandle: true,
      builder: (_) => const ProfileSheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).valueOrNull;
    final inVoice = ref.watch(voiceControllerProvider).connected;

    if (profile == null) {
      return const SizedBox(height: 120, child: Center(child: CircularProgressIndicator()));
    }

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            child: Row(
              children: [
                Avatar(name: profile.name, src: profile.photoURL, size: 48),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        profile.name,
                        style: AppTextStyles.base(),
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        profile.email,
                        style: AppTextStyles.xs(color: Palette.inkDim),
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      // Mirrors the web's subtitle, which swaps the role for
                      // "In voice" while connected.
                      if (inVoice)
                        Text(
                          'In voice',
                          style: AppTextStyles.xs(color: Palette.ok),
                        )
                      else
                        RoleBadge(role: profile.role, size: RoleBadgeSize.xs),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          // The web's gear menu, which is the closest thing it has to a
          // settings screen: voice settings while connected, then
          // notifications. Admin panel is omitted because it is a bottom-nav
          // tab here, and Sign out follows below.
          if (inVoice)
            SwitchListTile(
              value: ref.watch(voiceControllerProvider).speakerphone,
              onChanged: (v) => ref
                  .read(voiceControllerProvider.notifier)
                  .setSpeakerphone(v),
              secondary: Icon(Icons.volume_up, color: Palette.inkDim),
              title: Text('Speakerphone', style: AppTextStyles.sm()),
              subtitle: Text(
                // Deliberately not the web's device pickers. A browser
                // enumerates and selects audio devices itself; Android routes
                // at the OS level, so the honest mobile equivalent is choosing
                // earpiece vs speaker and letting the system handle the rest.
                'Play voice through the speaker instead of the earpiece.',
                style: AppTextStyles.xs(color: Palette.inkMuted),
              ),
            ),
          SwitchListTile(
            value: ref.watch(themeModeProvider) == ThemeMode.light,
            onChanged: (v) => ref
                .read(themeModeProvider.notifier)
                .setMode(v ? ThemeMode.light : ThemeMode.dark),
            secondary: Icon(
              ref.watch(themeModeProvider) == ThemeMode.light
                  ? Icons.light_mode
                  : Icons.dark_mode,
              color: Palette.inkDim,
            ),
            title: Text('Light mode', style: AppTextStyles.sm()),
            subtitle: Text(
              'Remembered on this device.',
              style: AppTextStyles.xs(color: Palette.inkMuted),
            ),
          ),
          const _NotificationsRow(),
          const Divider(height: 1),
          ListTile(
            leading: Icon(Icons.logout, color: Palette.bad),
            title: Text('Sign out', style: AppTextStyles.sm(color: Palette.bad)),
            onTap: () => _confirmSignOut(context, ref, inVoice: inVoice),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmSignOut(
    BuildContext context,
    WidgetRef ref, {
    required bool inVoice,
  }) async {
    // Confirmed rather than immediate: the web's is a menu item you can back
    // out of by clicking away, whereas a full-width row in a sheet is very easy
    // to hit by accident, and signing back in means another Google round trip.
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: Palette.bgRaised,
        title: Text('Sign out?', style: AppTextStyles.base()),
        content: Text(
          inVoice
              ? 'You are connected to a voice channel. Signing out will '
                  'disconnect you.'
              : 'You will need to sign in with Google again.',
          style: AppTextStyles.sm(color: Palette.inkDim),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text('Sign out', style: AppTextStyles.sm(color: Palette.bad)),
          ),
        ],
      ),
    );
    if (ok != true) return;

    // Leave voice BEFORE signing out. Teardown deletes this user's roster and
    // signaling docs, and the rules only permit that as the signed-in owner —
    // after signOut() every one of those writes is denied and the docs are left
    // for the staleness sweep to find two minutes later, during which everyone
    // else still sees a participant who has gone.
    if (inVoice) {
      await ref.read(voiceControllerProvider.notifier).leave();
    }
    await ref.read(authServiceProvider).signOut();
  }
}

/// Your own avatar, as an app-bar action that opens [ProfileSheet].
///
/// Lives in the two root tabs' app bars. The web has a permanent user row
/// because it has a sidebar to pin it to; the nearest phone convention is your
/// avatar top-right, which is also where the app previously had nothing at all.
class ProfileAvatarButton extends ConsumerWidget {
  const ProfileAvatarButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).valueOrNull;
    if (profile == null) return const SizedBox.shrink();
    return IconButton(
      tooltip: 'You',
      onPressed: () => ProfileSheet.show(context),
      icon: Avatar(name: profile.name, src: profile.photoURL, size: 28),
    );
  }
}

/// Notification permission, mirroring the web's three states: granted, blocked,
/// or still askable.
///
/// Android 13+ requires the runtime grant, and the app currently only ever asks
/// once, from the notification service's start(). Someone who declined then had
/// no way to change their mind inside the app — this is that way.
class _NotificationsRow extends StatefulWidget {
  const _NotificationsRow();

  @override
  State<_NotificationsRow> createState() => _NotificationsRowState();
}

class _NotificationsRowState extends State<_NotificationsRow> {
  PermissionStatus? _status;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final s = await Permission.notification.status;
    if (mounted) setState(() => _status = s);
  }

  Future<void> _onTap() async {
    // A permanently denied permission cannot be re-requested in-app — the
    // dialog simply never appears — so the only honest action is to send the
    // user to the OS settings page rather than a button that does nothing.
    if (_status == PermissionStatus.permanentlyDenied) {
      await openAppSettings();
      return;
    }
    await Permission.notification.request();
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final granted = _status == PermissionStatus.granted;
    final blocked = _status == PermissionStatus.permanentlyDenied;
    final label = _status == null
        ? 'Notifications'
        : granted
            ? 'Notifications: On'
            : blocked
                ? 'Notifications blocked'
                : 'Enable notifications';

    return ListTile(
      leading: Icon(
        granted ? Icons.notifications_active : Icons.notifications_off,
        color: granted ? Palette.inkDim : Palette.warn,
      ),
      title: Text(label, style: AppTextStyles.sm()),
      subtitle: blocked
          ? Text(
              'Turn them back on in Android settings.',
              style: AppTextStyles.xs(color: Palette.inkMuted),
            )
          : null,
      // Nothing to do when already granted; revoking is an OS-level action.
      onTap: granted ? null : _onTap,
    );
  }
}
