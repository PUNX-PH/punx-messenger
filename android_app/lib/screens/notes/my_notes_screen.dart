import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_providers.dart';
import '../../widgets/chat/chat_surface.dart';
import '../../widgets/shared/loading_view.dart';

/// Personal scratchpad at `users/{uid}/notes` — same chat surface as DMs and
/// channels, just self-scoped. Port of MyNotes.jsx.
class MyNotesScreen extends ConsumerWidget {
  const MyNotesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).valueOrNull;
    if (profile == null) {
      return const LoadingView(label: 'Loading notes');
    }
    return ChatSurface(
      title: 'My Notes',
      icon: '✎',
      path: 'users/${profile.id}/notes',
      composerPlaceholder: 'Jot something down…',
      emptyTitle: 'Your private notes',
      emptyDesc:
          'Only you can see these. Use it as a scratch pad — links, todos, anything.',
      canPin: true,
    );
  }
}
