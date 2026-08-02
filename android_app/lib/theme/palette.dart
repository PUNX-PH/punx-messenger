import 'package:flutter/widgets.dart';

/// Exact color palette ported from the web app's tailwind.config.js.
/// Dark theme only — the web app has no light mode.
abstract final class Palette {
  // Surfaces (darkest at structural edges, lightest where content is read)
  static const bgDeepest = Color(0xFF0A0E14); // server/group rail
  static const bgDark = Color(0xFF13161C); // channel/DM sidebar
  static const bgMain = Color(0xFF1A1E26); // chat surface background
  static const bgRaised = Color(0xFF22272F); // composer, modals, cards
  static const bgHover = Color(0xFF2D323D); // hovered/pressed surface

  // Lines / borders
  static const lineSubtle = Color(0xFF2D323D);
  static const lineStrong = Color(0xFF3A4150);

  // Text
  static const ink = Color(0xFFE5E7EB);
  static const inkMuted = Color(0xFFB0B6C0);
  static const inkDim = Color(0xFF6B7280);

  // Brand ("punx blurple")
  static const brand = Color(0xFF5865F2);
  static const brandHover = Color(0xFF4752C4);
  static const brandSoft = Color(0x265865F2); // ~15% alpha

  // Semantic
  static const ok = Color(0xFF10B981); // online / success
  static const warn = Color(0xFFF59E0B); // away / pinned accent / owner tag
  static const bad = Color(
    0xFFEF4444,
  ); // offline / error / destructive / unread dot
}
