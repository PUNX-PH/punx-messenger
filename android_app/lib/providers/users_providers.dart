import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/user_profile.dart';
import '../services/users_repository.dart';

final usersRepositoryProvider = Provider<UsersRepository>(
  (ref) => UsersRepository(),
);

/// Live workspace directory.
final usersStreamProvider = StreamProvider<List<UserProfile>>((ref) {
  return ref.watch(usersRepositoryProvider).listenUsers();
});

/// Derived uid -> profile lookup, for resolving live author/mention names.
///
/// Deliberately NOT filtered: identity lookups have to keep resolving people
/// who have been removed, or old messages and voice tiles lose their authors.
final usersByIdProvider = Provider<Map<String, UserProfile>>((ref) {
  final users = ref.watch(usersStreamProvider).valueOrNull ?? const [];
  return {for (final u in users) u.id: u};
});

/// Everyone still in the workspace — the list to offer whenever a person is
/// PICKED: the DM list, the mention autocomplete, add-members. Mirrors
/// `activeUsers` from src/lib/users.jsx.
///
/// A switched-off bot drops out of here too, without any bot-specific code:
/// setBotEnabled on the web writes the same `deactivated` field onto the bot's
/// users doc. Use usersStreamProvider only where removed accounts must still
/// be listed, which is the admin panel.
final activeUsersProvider = Provider<List<UserProfile>>((ref) {
  final users = ref.watch(usersStreamProvider).valueOrNull ?? const [];
  return users.where((u) => !u.deactivated).toList();
});
