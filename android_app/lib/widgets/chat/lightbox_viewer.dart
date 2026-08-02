import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../theme/palette.dart';

/// Full-screen image viewer for tapping a chat image — port of
/// components/Lightbox.jsx. The web version has no zoom/pan (just a
/// fullscreen view + close), but `InteractiveViewer` gives pinch-zoom for
/// free on mobile, which is a reasonable superset rather than a regression.
class LightboxViewer extends StatelessWidget {
  const LightboxViewer({super.key, required this.bytes});

  final Uint8List bytes;

  static void show(BuildContext context, Uint8List bytes) {
    Navigator.of(context).push(
      PageRouteBuilder(
        opaque: false,
        barrierColor: Colors.black.withValues(alpha: 0.85),
        pageBuilder: (context, _, _) => LightboxViewer(bytes: bytes),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: GestureDetector(
        onTap: () => Navigator.of(context).pop(),
        child: Stack(
          children: [
            Center(
              child: InteractiveViewer(
                child: Image.memory(bytes, fit: BoxFit.contain),
              ),
            ),
            Positioned(
              top: 8,
              right: 8,
              child: SafeArea(
                child: IconButton(
                  icon: const Icon(Icons.close, color: Palette.ink),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
