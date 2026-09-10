import 'package:flutter/material.dart';

import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// Port of components/TypingIndicator.jsx. Always reserves a fixed-height
/// row so the composer doesn't jump when someone starts/stops typing.
class TypingIndicator extends StatelessWidget {
  const TypingIndicator({super.key, required this.label});

  /// Pre-formatted by `typingLabelProvider`, null when nobody is typing. The
  /// formatting lives there rather than here so the value being watched is a
  /// String — see that provider on the rebuild loop this avoids.
  final String? label;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 18,
      child: label == null
          ? const SizedBox.shrink()
          : Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    label!,
                    style: AppTextStyles.xs(color: Palette.inkMuted),
                  ),
                  const SizedBox(width: 6),
                  const _PulsingDots(),
                ],
              ),
            ),
    );
  }
}

class _PulsingDots extends StatefulWidget {
  const _PulsingDots();
  @override
  State<_PulsingDots> createState() => _PulsingDotsState();
}

class _PulsingDotsState extends State<_PulsingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (i) {
            final phase = (_controller.value - i * 0.2) % 1.0;
            final opacity =
                0.3 + 0.7 * (phase < 0.5 ? phase * 2 : (1 - phase) * 2);
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 1),
              child: Opacity(
                opacity: opacity.clamp(0.3, 1.0),
                child: Container(
                  width: 4,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Palette.inkMuted,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            );
          }),
        );
      },
    );
  }
}
