import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/dm_providers.dart';
import '../../services/dm_open_error.dart';
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
      error: (error, _) {
        // Says which step failed and what it usually means, instead of the raw
        // "[cloud_firestore/permission-denied]" text, which could not tell a
        // removed account from a conversation document that does not list you.
        final problem = describeDmOpenError(error);
        return Scaffold(
          backgroundColor: Palette.bgMain,
          appBar: AppBar(title: const Text('Direct Message')),
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    problem.message,
                    textAlign: TextAlign.center,
                    style: AppTextStyles.sm(color: Palette.bad),
                  ),
                  if (problem.details.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    SelectableText(
                      problem.details,
                      textAlign: TextAlign.center,
                      style: AppTextStyles.xs(color: Palette.inkDim),
                    ),
                  ],
                  const SizedBox(height: 20),
                  OutlinedButton(
                    onPressed: () =>
                        ref.invalidate(dmChatContextProvider(otherUid)),
                    child: const Text('Try again'),
                  ),
                ],
              ),
            ),
          ),
        );
      },
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
