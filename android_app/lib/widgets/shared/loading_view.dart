import 'package:flutter/material.dart';

import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// Port of components/Loading.jsx — full-screen centered pulsing dot + label.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label = 'Loading'});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Palette.bgDeepest,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 10,
              height: 10,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Palette.brand,
                  shape: BoxShape.circle,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text(label, style: AppTextStyles.sm(color: Palette.inkMuted)),
          ],
        ),
      ),
    );
  }
}
