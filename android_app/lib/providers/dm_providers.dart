import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/dm_convo.dart';
import '../models/user_profile.dart';
import '../services/dm_repository.dart';
import 'auth_providers.dart';

final dmRepositoryProvider = Provider<DmRepository>((ref) => DmRepository());

/// Live DM convos the current user is in, keyed by the *other* member's uid.
final myDmConvosProvider = StreamProvider<Map<String, DmConvo>>((ref) {
  final uid = ref.watch(authStateProvider).valueOrNull?.uid;
  if (uid == null) return Stream.value(const {});
  return ref.watch(dmRepositoryProvider).listenMyDmConvos(uid);
});

/// Resolved DM chat context for a given `otherUid`: fetches the other user's
/// profile, ensures the DM convo doc exists, and builds the messages path —
/// 1:1 port of DMConvo.jsx's resolution flow.
class DmChatContext {
  final UserProfile other;
  final String convoId;
  final String messagesPath;
  const DmChatContext({
    required this.other,
    required this.convoId,
    required this.messagesPath,
  });
}

final dmChatContextProvider = FutureProvider.family<DmChatContext, String>((
  ref,
  otherUid,
) async {
  final me = ref.watch(profileProvider).valueOrNull;
  if (me == null) {
    throw StateError('Not signed in.');
  }
  final otherDoc = await FirebaseFirestore.instance
      .collection('users')
      .doc(otherUid)
      .get();
  if (!otherDoc.exists) {
    throw StateError("That teammate doesn't exist.");
  }
  final other = UserProfile.fromDoc(otherDoc);
  final convoId = await ref
      .watch(dmRepositoryProvider)
      .ensureDmConvo(me, other);
  return DmChatContext(
    other: other,
    convoId: convoId,
    messagesPath: 'dms/$convoId/messages',
  );
});
