import 'package:flutter/material.dart';

import '../../services/image_service.dart';
import '../../theme/palette.dart';

/// Port of components/Avatar.jsx. `src` may be a regular https URL (Google
/// account photo) or one of our own base64 `data:` URLs (group/message
/// avatars) — both render the same way here.
class Avatar extends StatelessWidget {
  const Avatar({
    super.key,
    required this.name,
    this.src,
    this.size = 32,
    this.status,
    this.ringColor,
  });

  final String name;
  final String? src;
  final double size;
  final String? status; // 'online' | 'away' | 'offline' | null (no dot)
  /// Defaults to the sidebar surface, resolved at build time because a
  /// default parameter value has to be a compile-time constant and the
  /// palette tokens are now getters.
  final Color? ringColor;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          ClipOval(
            child: SizedBox(width: size, height: size, child: _image()),
          ),
          if (status != null)
            Positioned(
              right: -1,
              bottom: -1,
              child: _StatusDot(
                status: status!,
                avatarSize: size,
                ringColor: ringColor ?? Palette.bgDark,
              ),
            ),
        ],
      ),
    );
  }

  Widget _image() {
    final s = src;
    if (s != null && s.isNotEmpty) {
      if (s.startsWith('data:')) {
        return Image.memory(
          ImageService.decodeDataUrl(s),
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _fallback(),
        );
      }
      return Image.network(
        s,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => _fallback(),
      );
    }
    return _fallback();
  }

  Widget _fallback() {
    return ColoredBox(
      color: Palette.brand,
      child: Center(
        child: Text(
          name.isNotEmpty ? name[0].toUpperCase() : '?',
          style: TextStyle(
            color: Colors.white,
            fontSize: size * 0.45,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({
    required this.status,
    required this.avatarSize,
    required this.ringColor,
  });

  final String status;
  final double avatarSize;
  final Color ringColor;

  @override
  Widget build(BuildContext context) {
    final dotColor = switch (status) {
      'online' => Palette.ok,
      'away' => Palette.warn,
      _ => Palette.inkDim,
    };
    final size = (avatarSize * 0.3).clamp(8.0, double.infinity);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: dotColor,
        border: Border.all(color: ringColor, width: 1.5),
      ),
    );
  }
}
