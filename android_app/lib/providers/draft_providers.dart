import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/draft_store.dart';
import 'auth_providers.dart';

/// The saved drafts. main() loads the real one before anything is drawn and
/// overrides this; anywhere else (tests, a widget shown on its own) it falls back
/// to one that lives only for the run, so a missing override is never a crash.
final draftStoreProvider = Provider<DraftStore>((ref) => DraftStore.inMemory());

/// Wipes every draft when the person signs out, so the next person on a shared
/// phone does not find the last one's half-written messages. Kept alive by PunxApp.
final draftCleanerProvider = Provider<void>((ref) {
  ref.listen<String?>(authStateProvider.select((a) => a.valueOrNull?.uid), (
    previous,
    next,
  ) {
    if (previous != null && next == null) {
      ref.read(draftStoreProvider).clearAll();
    }
  });
});
