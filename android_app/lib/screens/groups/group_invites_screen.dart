import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/channel.dart';
import '../../models/group.dart';
import '../../models/group_invite.dart';
import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../services/invites_repository.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// Create and revoke a group's invite links — port of components/GroupInvites.jsx.
///
/// A link grants a fixed set of channels and is reusable until it expires or is
/// revoked. Anyone who opens it and signs in with any Google account joins as a
/// guest, seeing those channels and nothing else; someone who already has an
/// account keeps whatever role they had. The link opens in the browser — joining
/// happens there, not in this app.
class GroupInvitesScreen extends ConsumerStatefulWidget {
  const GroupInvitesScreen({super.key, required this.groupId});
  final String groupId;

  @override
  ConsumerState<GroupInvitesScreen> createState() => _GroupInvitesScreenState();
}

class _GroupInvitesScreenState extends ConsumerState<GroupInvitesScreen> {
  final Set<String> _picked = {};
  int _days = 7;
  bool _busy = false;
  String? _error;
  String? _copiedToken;
  Timer? _copiedTimer;

  @override
  void dispose() {
    _copiedTimer?.cancel();
    super.dispose();
  }

  Future<void> _copy(String token) async {
    await Clipboard.setData(
      ClipboardData(text: InvitesRepository.inviteUrl(token)),
    );
    if (!mounted) return;
    setState(() => _copiedToken = token);
    _copiedTimer?.cancel();
    _copiedTimer = Timer(const Duration(milliseconds: 1600), () {
      if (mounted) setState(() => _copiedToken = null);
    });
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Link copied')));
  }

  Future<void> _create(
    Group group,
    List<Channel> channels,
    String myUid,
  ) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final chosen = channels.where((c) => _picked.contains(c.id)).toList();
      final invite = await ref
          .read(invitesRepositoryProvider)
          .createInvite(
            group: group,
            channels: chosen,
            createdBy: myUid,
            days: _days,
          );
      await _copy(invite.token);
      if (mounted) setState(_picked.clear);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(GroupInvite invite) async {
    // Unlike the web, ask first: this cannot be undone, and on a phone it sits
    // right next to Copy.
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Revoke this link?'),
        content: const Text(
          'Anyone who has it will no longer be able to join with it. '
          'This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text('Revoke', style: TextStyle(color: Palette.bad)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(invitesRepositoryProvider).revokeInvite(invite.token);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final group = ref.watch(groupProvider(widget.groupId)).valueOrNull;
    final profile = ref.watch(profileProvider).valueOrNull;

    if (group == null || profile == null) {
      return Scaffold(
        backgroundColor: Palette.bgMain,
        appBar: AppBar(title: const Text('Invite links')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    // Same test as the settings screen, and the same one the rules apply: group
    // admins and workspace admins.
    final canEdit =
        profile.role.isAdmin ||
        group.isAdmin(profile.id) ||
        group.isOwner(profile.id);
    if (!canEdit) {
      return Scaffold(
        backgroundColor: Palette.bgMain,
        appBar: AppBar(title: const Text('Invite links')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            "Only this group's admins can create invite links.",
            style: AppTextStyles.sm(color: Palette.inkMuted),
          ),
        ),
      );
    }

    final channels =
        ref.watch(channelsProvider(widget.groupId)).valueOrNull ??
        const <Channel>[];
    final invitesAsync = ref.watch(groupInvitesProvider(widget.groupId));
    final invites = invitesAsync.valueOrNull ?? const <GroupInvite>[];

    return Scaffold(
      backgroundColor: Palette.bgMain,
      appBar: AppBar(title: const Text('Invite links')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'New invite link',
              style: AppTextStyles.sm(weight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              "Pick the channels it should grant. Anyone with the link can join "
              "those channels — as a guest if they're new, keeping their role "
              'if they already have an account.',
              style: AppTextStyles.xs(color: Palette.inkMuted),
            ),
            const SizedBox(height: 12),
            _ChannelPicker(
              channels: channels,
              picked: _picked,
              enabled: !_busy,
              onToggle: (id, on) => setState(() {
                on ? _picked.add(id) : _picked.remove(id);
              }),
            ),
            const SizedBox(height: 12),
            Text(
              'Expires in',
              style: AppTextStyles.xs(color: Palette.inkMuted),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final o in inviteDayOptions)
                  ChoiceChip(
                    label: Text(o.label),
                    selected: _days == o.days,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _days = o.days),
                    selectedColor: Palette.brand,
                    labelStyle: TextStyle(
                      color: _days == o.days ? Colors.white : Palette.inkMuted,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _busy || _picked.isEmpty
                  ? null
                  : () => _create(group, channels, profile.id),
              child: Text(_busy ? 'Creating…' : 'Create & copy link'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Palette.bad.withValues(alpha: 0.1),
                  border: Border.all(color: Palette.bad.withValues(alpha: 0.2)),
                  borderRadius: BorderRadius.circular(AppRadii.md),
                ),
                child: Text(
                  _error!,
                  style: AppTextStyles.sm(color: Palette.bad),
                ),
              ),
            ],
            if (invitesAsync.hasError && invites.isEmpty) ...[
              const SizedBox(height: 12),
              Text(
                "Couldn't load the existing links: ${invitesAsync.error}",
                style: AppTextStyles.sm(color: Palette.bad),
              ),
            ],
            const SizedBox(height: 24),
            Text.rich(
              TextSpan(
                text: 'Existing links ',
                style: AppTextStyles.sm(weight: FontWeight.w700),
                children: [
                  TextSpan(
                    text: '(${invites.length})',
                    style: AppTextStyles.sm(color: Palette.inkMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            if (invites.isEmpty && !invitesAsync.isLoading)
              Text(
                'None yet.',
                style: AppTextStyles.xs(color: Palette.inkMuted),
              )
            else
              for (final inv in invites)
                _InviteCard(
                  invite: inv,
                  copied: _copiedToken == inv.token,
                  onCopy: () => _copy(inv.token),
                  onRevoke: () => _revoke(inv),
                ),
          ],
        ),
      ),
    );
  }
}

class _ChannelPicker extends StatelessWidget {
  const _ChannelPicker({
    required this.channels,
    required this.picked,
    required this.enabled,
    required this.onToggle,
  });

  final List<Channel> channels;
  final Set<String> picked;
  final bool enabled;
  final void Function(String id, bool on) onToggle;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Palette.lineSubtle),
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: channels.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                'No channels in this group yet.',
                style: AppTextStyles.xs(color: Palette.inkMuted),
              ),
            )
          : Column(
              children: [
                for (final c in channels)
                  CheckboxListTile(
                    value: picked.contains(c.id),
                    onChanged: enabled
                        ? (on) => onToggle(c.id, on ?? false)
                        : null,
                    activeColor: Palette.brand,
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    secondary: Icon(
                      c.type == 'voice' ? Icons.volume_up : Icons.tag,
                      size: 18,
                      color: Palette.inkMuted,
                    ),
                    title: Text(c.name, style: AppTextStyles.sm()),
                    subtitle: c.private
                        ? Text(
                            'Private',
                            style: AppTextStyles.xs(color: Palette.inkMuted),
                          )
                        : null,
                  ),
              ],
            ),
    );
  }
}

class _InviteCard extends StatelessWidget {
  const _InviteCard({
    required this.invite,
    required this.copied,
    required this.onCopy,
    required this.onRevoke,
  });

  final GroupInvite invite;
  final bool copied;
  final VoidCallback onCopy;
  final VoidCallback onRevoke;

  @override
  Widget build(BuildContext context) {
    final live = invite.isLive();
    final status = invite.statusLabel();
    final channels = invite.channelNames.map((n) => '#$n').join(', ');
    // A dead link is dimmed by COLOUR rather than opacity: fading the whole card
    // would push its text under the 4.5:1 contrast floor.
    final textColor = live ? Palette.ink : Palette.inkMuted;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
      decoration: BoxDecoration(
        border: Border.all(color: Palette.lineSubtle),
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  channels.isEmpty ? 'no channels' : channels,
                  style: AppTextStyles.sm(color: textColor),
                ),
              ),
              if (status != null) ...[
                const SizedBox(width: 8),
                Text(
                  status.toUpperCase(),
                  style: AppTextStyles.xs(
                    color: Palette.inkMuted,
                    weight: FontWeight.w600,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 4),
          Text(
            InvitesRepository.inviteUrl(invite.token),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.xs(color: Palette.inkDim),
          ),
          Row(
            children: [
              Expanded(
                child: Text(
                  invite.expiryLabel(),
                  style: AppTextStyles.xs(color: Palette.inkDim),
                ),
              ),
              if (live)
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    TextButton(
                      onPressed: onCopy,
                      child: Text(
                        copied ? 'Copied' : 'Copy',
                        style: TextStyle(color: Palette.brandText),
                      ),
                    ),
                    TextButton(
                      onPressed: onRevoke,
                      child: Text(
                        'Revoke',
                        style: TextStyle(color: Palette.inkMuted),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}
