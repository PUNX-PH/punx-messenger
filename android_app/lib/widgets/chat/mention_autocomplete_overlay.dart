import 'package:flutter/material.dart';

import '../../models/user_profile.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../shared/avatar.dart';

/// Candidate dropdown shown above the composer while typing `@partial-name`
/// — presentational half of the @mention autocomplete (see Composer.jsx);
/// the detection/insertion logic lives in composer.dart since it's tightly
/// coupled to the text field's controller/cursor state.
class MentionAutocompleteOverlay extends StatelessWidget {
  const MentionAutocompleteOverlay({
    super.key,
    required this.candidates,
    required this.onPick,
  });

  final List<UserProfile> candidates;
  final ValueChanged<UserProfile> onPick;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxHeight: 176),
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        color: Palette.bgDeepest,
        borderRadius: BorderRadius.circular(AppRadii.md),
        border: Border.all(color: Palette.lineSubtle),
      ),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 4),
        children: [
          for (final u in candidates)
            ListTile(
              dense: true,
              leading: Avatar(name: u.name, src: u.photoURL, size: 24),
              title: Text(u.name, style: AppTextStyles.sm()),
              subtitle: Text(
                u.email,
                style: AppTextStyles.xs(color: Palette.inkDim),
              ),
              onTap: () => onPick(u),
            ),
        ],
      ),
    );
  }
}
