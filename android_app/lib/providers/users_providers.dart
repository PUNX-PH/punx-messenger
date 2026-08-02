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
final usersByIdProvider = Provider<Map<String, UserProfile>>((ref) {
  final users = ref.watch(usersStreamProvider).valueOrNull ?? const [];
  return {for (final u in users) u.id: u};
});
