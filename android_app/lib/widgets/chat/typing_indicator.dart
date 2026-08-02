import 'package:flutter/material.dart';

import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// Port of components/TypingIndicator.jsx. Always reserves a fixed-height
/// row so the composer doesn't jump when someone starts/stops typing.
class TypingIndicator extends StatelessWidget {
  const TypingIndicator({super.key, required this.names});

  final List<String> names;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 18,
      child: names.isEmpty
          ? const SizedBox.shrink()
          : Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _label(names),
                    style: AppTextStyles.xs(color: Palette.inkMuted),
                  ),
                  const SizedBox(width: 6),
                  const _PulsingDots(),
                ],
              ),
            ),
    );
  }

  String _label(List<String> names) {
    if (names.length == 1) return '${names[0]} is typing…';
    if (names.length == 2) return '${names[0]} and ${names[1]} are typing…';
    final extra = names.length - 2;
    return '${names[0]}, ${names[1]}, and $extra ${extra == 1 ? 'other' : 'others'} are typing…';
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
                  decoration: const BoxDecoration(
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
