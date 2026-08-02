import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/custom_emoji.dart';
import '../services/emojis_repository.dart';

final emojisRepositoryProvider = Provider<EmojisRepository>(
  (ref) => EmojisRepository(),
);

/// Live workspace-wide custom emoji list.
final emojisStreamProvider = StreamProvider<List<CustomEmoji>>((ref) {
  return ref.watch(emojisRepositoryProvider).listenEmojis();
});

/// Derived name -> emoji lookup for rendering `:name:` tokens.
final emojiByNameProvider = Provider<Map<String, CustomEmoji>>((ref) {
  final emojis = ref.watch(emojisStreamProvider).valueOrNull ?? const [];
  return {for (final e in emojis) e.name: e};
});
