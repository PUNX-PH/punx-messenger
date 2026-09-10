import 'package:flutter/material.dart';

import '../../models/message.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// Pinned-messages panel — port of ChatSurface.jsx's PinnedDropdown.
void showPinnedMessagesSheet(
  BuildContext context, {
  required List<ChatMessage> messages,
  required bool canPin,
  required ValueChanged<String> onJump,
  required ValueChanged<ChatMessage> onUnpin,
}) {
  // Newest pinned first.
  final pinned = messages.where((m) => m.pinned).toList().reversed.toList();

  showModalBottomSheet(
    context: context,
    backgroundColor: Palette.bgRaised,
    isScrollControlled: true,
    builder: (context) {
      return SafeArea(
        child: DraggableScrollableSheet(
          initialChildSize: 0.6,
          minChildSize: 0.3,
          maxChildSize: 0.9,
          expand: false,
          builder: (context, scrollController) {
            if (pinned.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'Hover any message and use its menu to pin important things here.',
                    textAlign: TextAlign.center,
                    style: AppTextStyles.sm(color: Palette.inkMuted),
                  ),
                ),
              );
            }
            return ListView.builder(
              controller: scrollController,
              padding: const EdgeInsets.all(12),
              itemCount: pinned.length,
              itemBuilder: (context, index) {
                final m = pinned[index];
                return ListTile(
                  title: Text(
                    m.author.name,
                    style: AppTextStyles.sm(weight: FontWeight.w600),
                  ),
                  subtitle: Text(
                    m.text.isNotEmpty
                        ? m.text
                        : (m.imageURL != null ? '[image]' : ''),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.sm(color: Palette.inkMuted),
                  ),
                  trailing: canPin
                      ? IconButton(
                          icon: Icon(
                            Icons.push_pin,
                            size: 16,
                            color: Palette.warn,
                          ),
                          tooltip: 'Unpin',
                          onPressed: () => onUnpin(m),
                        )
                      : null,
                  onTap: () {
                    Navigator.of(context).pop();
                    onJump(m.id);
                  },
                );
              },
            );
          },
        ),
      );
    },
  );
}
