import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/channel.dart';
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

final channelsProvider = StreamProvider.family<List<Channel>, String>((
  ref,
  groupId,
) {
  return ref.watch(groupsRepositoryProvider).listenChannels(groupId);
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
