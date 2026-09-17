import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/channel.dart';
import '../../models/group.dart';
import '../../providers/auth_providers.dart';
import '../../providers/voice_channel_providers.dart';
import '../../providers/users_providers.dart';
import '../../providers/groups_providers.dart';
import '../../router/route_paths.dart';
import '../../services/image_service.dart';
import '../../services/voice_channel_repository.dart';
import '../../models/voice_participant.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/firestore_paths.dart';
import 'channel_access_sheet.dart';

/// Mobile equivalent of ChannelSidebar.jsx — the channel picker for a group.
/// Unlike the desktop app (where a persistent sidebar makes GroupHome.jsx a
/// pure "jump to #general" redirect), this is a real screen the user can
/// come back to via the system back button, so it stays a genuine list
/// rather than auto-redirecting into a channel every time.
class ChannelListScreen extends ConsumerWidget {
  const ChannelListScreen({super.key, required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final group = ref.watch(groupProvider(groupId)).valueOrNull;
    final channels =
        ref.watch(channelsProvider(groupId)).valueOrNull ?? const [];
    // Selected down to the two fields this screen needs, NOT the whole
    // profile. profileProvider is a live snapshot of your own user doc and maps
    // every snapshot to a new UserProfile — which defines no ==, so it compares
    // by identity. Presence rewrites lastSeen every 45s and marking a channel
    // read rewrites lastRead, so watching the object itself rebuilt this entire
    // screen on both. A record of (id, admin) has value equality, so it only
    // fires when one of them actually changes.
    final me = ref.watch(
      profileProvider.select((p) {
        final v = p.valueOrNull;
        return v == null ? null : (id: v.id, admin: v.role.isAdmin);
      }),
    );
    final elevated =
        me != null &&
        (me.admin || (group?.adminUids.contains(me.id) ?? false));

    return Scaffold(
      backgroundColor: Palette.bgDark,
      appBar: AppBar(title: Text(group?.name ?? 'Group')),
      body: Column(
        children: [
          if (group?.bannerURL != null) _GroupBanner(group: group!),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                Text(
                  'TEXT CHANNELS',
                  style: AppTextStyles.xs(
                    color: Palette.inkDim,
                    weight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                if (elevated)
                  IconButton(
                    icon: Icon(
                      Icons.add,
                      size: 18,
                      color: Palette.inkMuted,
                    ),
                    onPressed: () => _createChannel(context, ref, me.id),
                  ),
              ],
            ),
          ),
          Expanded(
            child: channels.isEmpty
                ? Center(
                    child: Text(
                      'No channels yet.',
                      style: AppTextStyles.sm(color: Palette.inkMuted),
                    ),
                  )
                : ListView.builder(
                    itemCount: channels.length,
                    itemBuilder: (context, index) => _ChannelRow(
                      groupId: groupId,
                      channel: channels[index],
                      elevated: elevated,
                      memberUids: group?.memberUids ?? const [],
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _createChannel(
    BuildContext context,
    WidgetRef ref,
    String createdBy,
  ) async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Palette.bgRaised,
        title: const Text('Create channel'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'new-channel'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    if (name == null || name.trim().isEmpty) return;
    final channelId = await ref
        .read(groupsRepositoryProvider)
        .createChannel(groupId, name: name, createdBy: createdBy);
    if (context.mounted) {
      context.push(RoutePaths.channelPath(groupId, channelId));
    }
  }
}

class _GroupBanner extends StatelessWidget {
  const _GroupBanner({required this.group});
  final Group group;

  @override
  Widget build(BuildContext context) {
    final bannerURL = group.bannerURL ?? '';
    if (bannerURL.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 72,
      width: double.infinity,
      child: Image.memory(
        ImageService.decodeDataUrl(bannerURL),
        fit: BoxFit.cover,
      ),
    );
  }
}

/// Who is in a voice channel, under its name in the list.
///
/// Deliberately shows names rather than an avatar stack: on a phone the row is
/// narrow, and "Rey, Emma" answers "is it worth joining" better than two 16px
/// circles do. Renders nothing at all when the channel is empty, so a quiet
/// list stays quiet.
/// One channel row.
///
/// Its own widget so it can select ONLY its own lastRead entry. A Timestamp has
/// value equality, so marking one channel read no longer rebuilds every other
/// row — and presence churn on the profile doc reaches none of them.
class _ChannelRow extends ConsumerWidget {
  const _ChannelRow({
    required this.groupId,
    required this.channel,
    required this.elevated,
    required this.memberUids,
  });

  final String groupId;
  final Channel channel;
  final bool elevated;
  final List<String> memberUids;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = channel;
    final isVoice = c.type == 'voice';

    final readKey = pathToReadKey('groups/$groupId/channels/${c.id}');
    final lastReadAt = ref.watch(
      profileProvider.select((p) => p.valueOrNull?.lastRead[readKey]),
    );
    final unread = isUnread(c.lastMessageAt, lastReadAt);

    return ListTile(
      // Every leading variant in the same 24x24 centred box.
      //
      // Before, the three cases were a size-18 Icon, a size-16 Icon and a Text
      // glyph, so both the title's left edge and the icon's vertical position
      // shifted per row. The Text case is the worst of the three: a glyph sits
      // on a baseline while an Icon centres on its box, so '#' and the lock
      // never lined up with each other.
      leading: SizedBox(
        width: 24,
        height: 24,
        child: Center(
          // A private channel only reaches this list if the viewer is allowed
          // it — listenChannels queries exactly what the rules will serve — so
          // the lock is a label, not a gate.
          child: isVoice
              ? Icon(Icons.volume_up, size: 18, color: Palette.inkDim)
              : c.private
                  ? Icon(Icons.lock_outline, size: 18,
                      color: Palette.inkDim)
                  : Text('#', style: AppTextStyles.base(color: Palette.inkDim)),
        ),
      ),
      // Roster inside the title rather than in `subtitle`, deliberately.
      // A non-null subtitle puts ListTile into its two-line layout, which
      // top-aligns the leading widget — so voice rows had their icon sitting
      // higher than text rows even when the roster line rendered nothing at
      // all. Keeping subtitle null means every row centres identically.
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            c.name,
            style: AppTextStyles.sm(
              weight: unread ? FontWeight.w700 : FontWeight.w400,
            ),
          ),
          if (isVoice) _VoiceRosterLine(groupId: groupId, channelId: c.id),
        ],
      ),
      // An unread dot is meaningless for a voice channel: there are no
      // messages to have missed.
      trailing: unread && !isVoice
          ? SizedBox(
              width: 8,
              height: 8,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Palette.bad,
                  shape: BoxShape.circle,
                ),
              ),
            )
          : null,
      onTap: () => context.push(RoutePaths.channelPath(groupId, c.id)),
      // Long-press for access control, admins only. `elevated` is the same test
      // as adminOverGroup() on the channel update rule, so the UI never offers
      // a write Firestore will refuse.
      onLongPress: !elevated
          ? null
          : () => ChannelAccessSheet.show(
                context,
                groupId: groupId,
                channel: c,
                memberUids: memberUids,
              ),
    );
  }
}

/// Who is sitting in a voice channel, under its row in the list.
///
/// Also where stale roster docs get cleaned up, mirroring
/// `components/voice/VoiceParticipants.jsx`, which sweeps every 30s for anyone
/// with the sidebar open whether or not they are in voice.
///
/// Android had no such sweep: only the voice ROOM pruned, and only while you
/// were inside it. So a doc left behind by a client that crashed or was killed
/// — teardown only runs on a clean leave — showed someone sitting in a channel
/// indefinitely, because on a phone nobody was ever looking from a place that
/// pruned. That is why an account which had merely logged in appeared to be in
/// a voice channel it never joined.
class _VoiceRosterLine extends ConsumerStatefulWidget {
  const _VoiceRosterLine({required this.groupId, required this.channelId});

  final String groupId;
  final String channelId;

  @override
  ConsumerState<_VoiceRosterLine> createState() => _VoiceRosterLineState();
}

class _VoiceRosterLineState extends ConsumerState<_VoiceRosterLine> {
  Timer? _pruneTimer;
  Timer? _firstPrune;

  @override
  void initState() {
    super.initState();
    // Same cadence as the web's sidebar sweep.
    _pruneTimer = Timer.periodic(const Duration(seconds: 30), (_) => _prune());

    // A first pass shortly after mount, because the periodic timer alone never
    // ran in the case that matters. Opening this list is what you do in order
    // to JOIN a channel, so the visit lasts a few seconds and the first tick at
    // +30s never arrives — the sweep existed but effectively only ran for
    // someone who left the list sitting open.
    //
    // Delayed rather than immediate: a doc written moments ago can read back
    // with an unresolved timestamp. The sweep already refuses to judge those,
    // so this is belt-and-braces, not the reason for the delay.
    _firstPrune = Timer(const Duration(seconds: 2), _prune);
  }

  @override
  void dispose() {
    _pruneTimer?.cancel();
    _firstPrune?.cancel();
    super.dispose();
  }

  void _prune() {
    // The uid is only so the sweep can sanity-check this device's clock
    // against a server timestamp before deleting anyone — see
    // VoiceChannelRepository.clockLooksWrong. `joined` is what tells it
    // whether a row bearing that uid is my heartbeat or my leftover.
    final myUid = ref.read(authStateProvider).value?.uid;
    ref.read(voiceChannelRepositoryProvider).pruneStaleParticipants(
          widget.groupId,
          widget.channelId,
          myUid: myUid,
          joined: _joinedHere,
        );
  }

  /// Whether this client is connected to THIS voice channel right now.
  bool get _joinedHere =>
      ref
          .read(voiceControllerProvider)
          .active
          ?.same(widget.groupId, widget.channelId) ??
      false;

  @override
  Widget build(BuildContext context) {
    final groupId = widget.groupId;
    final channelId = widget.channelId;
    final all =
        ref
            .watch(
              voiceRosterProvider((groupId: groupId, channelId: channelId)),
            )
            .valueOrNull ??
        const <VoiceParticipant>[];

    // Filtered for display as well as swept, so a ghost disappears on the next
    // frame rather than waiting for a delete to land — and stays gone even if
    // that delete is refused.
    //
    // My own row is filtered on a different test to everyone else's. Theirs is
    // a guess from heartbeat age, and has to be: a silent client is
    // indistinguishable from a dead one, so it gets staleAfter's worth of
    // benefit of the doubt. Mine is not a guess. If this device is not in the
    // channel then that row is a leftover, however recently it was written —
    // and after a force-kill it is written seconds ago, so the age test passed
    // and the app showed you sitting in a channel you were looking at from the
    // outside for the next two minutes.
    final now = DateTime.now();
    final myUid = ref.watch(authStateProvider).value?.uid;
    final joinedHere = ref
            .watch(voiceControllerProvider)
            .active
            ?.same(groupId, channelId) ??
        false;
    final roster = all
        .where((p) => p.uid != myUid || joinedHere)
        .where((p) => !VoiceChannelRepository.isStale(p.lastHeartbeat, now))
        .toList();
    if (roster.isEmpty) return const SizedBox.shrink();

    // `select` down to the finished string, NOT the whole map.
    //
    // usersByIdProvider rebuilds a fresh Map on every emission of the users
    // collection, and Map compares by identity — so watching it directly
    // rebuilt this row every time ANY user's presence heartbeat rewrote their
    // lastSeen (every 45s each, so constantly once a few people are online),
    // even though none of it changes a name. Selecting the joined names means
    // this only rebuilds when the displayed text differs.
    //
    // Still the unfiltered directory: someone who has left the workspace but is
    // still sitting in the channel must resolve to a name.
    final names = ref.watch(
      usersByIdProvider.select(
        (byId) =>
            roster.map((p) => byId[p.uid]?.name ?? 'Someone').join(', '),
      ),
    );

    return Text(
      names,
      overflow: TextOverflow.ellipsis,
      style: AppTextStyles.xs(color: Palette.ok),
    );
  }
}
