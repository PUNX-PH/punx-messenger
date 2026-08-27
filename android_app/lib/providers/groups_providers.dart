import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/channel.dart';
import '../models/channel_viewer.dart';
import '../models/group.dart';
import '../services/groups_repository.dart';
import '../utils/firestore_paths.dart';
import 'auth_providers.dart';

final groupsRepositoryProvider = Provider<GroupsRepository>(
  (ref) => GroupsRepository(),
);

/// Groups the signed-in user belongs to.
final myGroupsProvider = StreamProvider<List<Group>>((ref) {
  final uid = ref.watch(authStateProvider).valueOrNull?.uid;
  if (uid == null) return Stream.value(const []);
  return ref.watch(groupsRepositoryProvider).listenMyGroups(uid);
});

/// Which channel queries this user may run in this group — see ChannelViewer
/// and GroupsRepository.listenChannels.
///
/// Watches the three scalars it needs rather than the whole profile and group:
/// the user document changes on every presence heartbeat and the group
/// document on every membership edit, and rebuilding the channel streams that
/// often would empty the list each time. Records compare by value, so the
/// select only fires when the id or the role actually changes.
final channelViewerProvider = Provider.family<ChannelViewer, String>((
  ref,
  groupId,
) {
  final (uid, role) = ref.watch(
    profileProvider.select((p) => (p.valueOrNull?.id, p.valueOrNull?.role)),
  );
  final groupAdmin = ref.watch(
    groupProvider(
      groupId,
    ).select((g) => uid != null && (g.valueOrNull?.isAdmin(uid) ?? false)),
  );
  final guest = role?.isGuest ?? false;
  return ChannelViewer(
    uid: uid,
    guest: guest,
    seesPrivate:
        uid != null && !guest && ((role?.isAdmin ?? false) || groupAdmin),
  );
});

final channelsProvider = StreamProvider.family<List<Channel>, String>((
  ref,
  groupId,
) {
  return ref
      .watch(groupsRepositoryProvider)
      .listenChannels(groupId, viewer: ref.watch(channelViewerProvider(groupId)));
});

final groupProvider = StreamProvider.family<Group?, String>((ref, groupId) {
  return ref.watch(groupsRepositoryProvider).listenGroup(groupId);
});

/// True if any channel in the group is unread for the current user (and the
/// group isn't muted) — mirrors ServerRail.jsx's groupHasUnread().
final groupHasUnreadProvider = Provider.family<bool, String>((ref, groupId) {
  final profile = ref.watch(profileProvider).valueOrNull;
  if (profile == null || profile.mutedGroups.contains(groupId)) return false;
  final channels = ref.watch(channelsProvider(groupId)).valueOrNull ?? const [];
  return channels.any(
    (c) => isUnread(
      c.lastMessageAt,
      profile.lastRead[pathToReadKey('groups/$groupId/channels/${c.id}')],
    ),
  );
});
