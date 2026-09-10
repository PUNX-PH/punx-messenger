import 'package:flutter/material.dart';

import '../../models/custom_emoji.dart';
import '../../services/image_service.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

final _customEmojiTokenRe = RegExp(
  r'^:[a-z0-9_]{2,32}:$',
  caseSensitive: false,
);

/// Reaction chips row under a message, plus an "add reaction" button — port
/// of the reactions section in MessageList.jsx.
class ReactionChips extends StatelessWidget {
  const ReactionChips({
    super.key,
    required this.reactions,
    required this.meUid,
    required this.emojiByName,
    required this.onToggle,
    required this.onAddReaction,
  });

  final Map<String, List<String>> reactions;
  final String? meUid;
  final Map<String, CustomEmoji> emojiByName;
  final ValueChanged<String> onToggle;
  final VoidCallback onAddReaction;

  @override
  Widget build(BuildContext context) {
    final entries = reactions.entries.where((e) => e.value.isNotEmpty).toList();
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Wrap(
        spacing: 4,
        runSpacing: 4,
        children: [
          for (final e in entries)
            _ReactionChip(
              reactionKey: e.key,
              uids: e.value,
              mine: meUid != null && e.value.contains(meUid),
              emojiByName: emojiByName,
              onTap: () => onToggle(e.key),
            ),
          GestureDetector(
            onTap: onAddReaction,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              decoration: BoxDecoration(
                border: Border.all(color: Palette.lineSubtle),
                borderRadius: BorderRadius.circular(AppRadii.sm),
              ),
              child: Icon(
                Icons.add_reaction_outlined,
                size: 14,
                color: Palette.inkDim,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReactionChip extends StatelessWidget {
  const _ReactionChip({
    required this.reactionKey,
    required this.uids,
    required this.mine,
    required this.emojiByName,
    required this.onTap,
  });

  final String reactionKey;
  final List<String> uids;
  final bool mine;
  final Map<String, CustomEmoji> emojiByName;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    Widget glyph;
    if (_customEmojiTokenRe.hasMatch(reactionKey)) {
      final name = reactionKey
          .substring(1, reactionKey.length - 1)
          .toLowerCase();
      final emoji = emojiByName[name];
      glyph = emoji != null
          ? Image.memory(
              ImageService.decodeDataUrl(emoji.dataURL),
              width: 16,
              height: 16,
            )
          : Text(reactionKey, style: AppTextStyles.xs());
    } else {
      glyph = Text(reactionKey, style: const TextStyle(fontSize: 14));
    }

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        decoration: BoxDecoration(
          color: mine ? Palette.brandSoft : Palette.bgRaised,
          border: Border.all(color: mine ? Palette.brand : Palette.lineSubtle),
          borderRadius: BorderRadius.circular(AppRadii.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            glyph,
            const SizedBox(width: 4),
            Text(
              '${uids.length}',
              style: AppTextStyles.xs(
                color: mine ? Palette.brand : Palette.inkMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
