import 'package:flutter/material.dart';

import '../../theme/palette.dart';
import '../../utils/formatting.dart';

/// The buttons that format the selected text in the message box (bold, italic, strikethrough, code,
/// spoiler). What they do is in utils/formatting.dart; the box is told which one was pressed.
class FormatBar extends StatelessWidget {
  const FormatBar({super.key, required this.onFormat, this.enabled = true});

  final ValueChanged<String> onFormat;

  /// Off while a message is going out.
  final bool enabled;

  static const _icons = <String, IconData>{
    'bold': Icons.format_bold,
    'italic': Icons.format_italic,
    'strike': Icons.format_strikethrough,
    'code': Icons.code,
    'spoiler': Icons.visibility_off_outlined,
  };

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'Format the selected text',
      child: Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(
          children: [
            for (final b in formatButtons)
              IconButton(
                key: ValueKey('format-${b.name}'),
                tooltip: b.label,
                icon: Icon(_icons[b.name], color: Palette.inkMuted),
                onPressed: enabled ? () => onFormat(b.name) : null,
              ),
          ],
        ),
      ),
    );
  }
}
