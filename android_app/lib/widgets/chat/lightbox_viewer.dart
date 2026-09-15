import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../theme/palette.dart';

/// Full-screen image viewer for tapping a chat image — port of
/// components/Lightbox.jsx. The web version has no zoom/pan (just a
/// fullscreen view + close), but `InteractiveViewer` gives pinch-zoom for
/// free on mobile, which is a reasonable superset rather than a regression.
class LightboxViewer extends StatelessWidget {
  /// Exactly one of [bytes] and [url] is non-null: an inlined upload, or a
  /// remote GIF. See ImageService.isRemoteUrl.
  const LightboxViewer({super.key, this.bytes, this.url})
      : assert((bytes == null) != (url == null),
            'pass exactly one of bytes or url');

  final Uint8List? bytes;
  final String? url;

  static void show(BuildContext context, Uint8List bytes) =>
      _push(context, LightboxViewer(bytes: bytes));

  static void showUrl(BuildContext context, String url) =>
      _push(context, LightboxViewer(url: url));

  static void _push(BuildContext context, Widget viewer) {
    Navigator.of(context).push(
      PageRouteBuilder(
        opaque: false,
        barrierColor: Colors.black.withValues(alpha: 0.85),
        pageBuilder: (context, _, _) => viewer,
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
                child: bytes != null
                    ? Image.memory(bytes!, fit: BoxFit.contain)
                    : Image.network(url!, fit: BoxFit.contain),
              ),
            ),
            Positioned(
              top: 8,
              right: 8,
              child: SafeArea(
                child: IconButton(
                  icon: Icon(Icons.close, color: Palette.ink),
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
