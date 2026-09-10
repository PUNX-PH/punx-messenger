import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/dm_providers.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../widgets/calls/call_button.dart';
import '../../widgets/chat/chat_surface.dart';

/// Resolves `otherUid` -> user doc, ensures the DM convo doc, then hands off
/// to the shared chat surface — port of DMConvo.jsx.
class DmChatScreen extends ConsumerWidget {
  const DmChatScreen({super.key, required this.otherUid});

  final String otherUid;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contextAsync = ref.watch(dmChatContextProvider(otherUid));

    return contextAsync.when(
      loading: () => Scaffold(
        backgroundColor: Palette.bgMain,
        body: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => Scaffold(
        backgroundColor: Palette.bgMain,
        appBar: AppBar(title: const Text('Direct Message')),
        body: Center(
          child: Text('$error', style: AppTextStyles.sm(color: Palette.bad)),
        ),
      ),
      data: (dmContext) => ChatSurface(
        title: dmContext.other.name,
        icon: '@',
        path: dmContext.messagesPath,
        composerPlaceholder: 'Message @${dmContext.other.name}',
        emptyTitle:
            'This is the start of your conversation with ${dmContext.other.name}.',
        emptyDesc: 'Only the two of you can see these messages.',
        canPin: true,
        headerActions: [CallButton(otherUid: otherUid)],
      ),
    );
  }
}
