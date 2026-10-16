import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/user_profile.dart';
import '../services/users_identity.dart';
import '../services/users_repository.dart';
import 'presence_providers.dart';

final usersRepositoryProvider = Provider<UsersRepository>(
  (ref) => UsersRepository(),
);

/// Live workspace directory.
///
/// Emits only when WHO people are changes — a name, photo, role, deactivation.
/// A heartbeat, an away/online flip or someone reading a channel arrives as a
/// snapshot too, but changes nothing a screen shows, so it is not passed on: it
/// used to rebuild every screen watching the directory, the message list included,
/// each time anyone's `lastSeen` landed. Presence goes to [presenceStoreProvider]
/// instead, in batches. See services/users_identity.dart.
final usersStreamProvider = StreamProvider<List<UserProfile>>((ref) async* {
  final store = ref.read(presenceStoreProvider.notifier);
  var identities = <String, IdentityEntry>{};
  List<UserProfile>? last;

  await for (final raw in ref.watch(usersRepositoryProvider).listenUsers()) {
    final out = shareIdentity(identities, raw);
    identities = out.next;

    final changed = last == null || !sameUsers(last, out.users);
    // A rebuild is happening anyway when the people changed (and on the very
    // first snapshot), so publish presence with it; otherwise let it batch.
    store.publish(out.presence, immediate: changed);
    if (changed) {
      last = out.users;
      yield out.users;
    }
  }
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
