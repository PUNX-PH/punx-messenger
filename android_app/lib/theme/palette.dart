import 'package:flutter/widgets.dart';

/// One complete set of colour tokens. Ported from the web's
/// tailwind.config.js, which now carries the same two sets as CSS variables.
class PaletteTokens {
  const PaletteTokens({
    required this.bgDeepest,
    required this.bgDark,
    required this.bgMain,
    required this.bgRaised,
    required this.bgHover,
    required this.lineSubtle,
    required this.lineStrong,
    required this.ink,
    required this.inkMuted,
    required this.inkDim,
    required this.brand,
    required this.brandHover,
    required this.brandSoft,
    required this.ok,
    required this.warn,
    required this.bad,
  });

  final Color bgDeepest;
  final Color bgDark;
  final Color bgMain;
  final Color bgRaised;
  final Color bgHover;
  final Color lineSubtle;
  final Color lineStrong;
  final Color ink;
  final Color inkMuted;
  final Color inkDim;
  final Color brand;
  final Color brandHover;
  final Color brandSoft;
  final Color ok;
  final Color warn;
  final Color bad;
}

/// Surfaces darkest at structural edges, lightest where content is read.
const paletteDark = PaletteTokens(
  bgDeepest: Color(0xFF0A0E14), // server/group rail
  bgDark: Color(0xFF13161C), // channel/DM sidebar
  bgMain: Color(0xFF1A1E26), // chat surface background
  bgRaised: Color(0xFF22272F), // composer, modals, cards
  bgHover: Color(0xFF2D323D), // hovered/pressed surface
  lineSubtle: Color(0xFF2D323D),
  lineStrong: Color(0xFF3A4150),
  ink: Color(0xFFE5E7EB),
  inkMuted: Color(0xFFB0B6C0),
  inkDim: Color(0xFF6B7280),
  brand: Color(0xFF5865F2), // "punx blurple"
  brandHover: Color(0xFF4752C4),
  brandSoft: Color(0x265865F2), // ~15% alpha
  ok: Color(0xFF10B981), // online / success
  warn: Color(0xFFF59E0B), // away / pinned accent / owner tag
  bad: Color(0xFFEF4444), // offline / error / destructive / unread dot
);

/// The same structure inverted: edges slightly grey, content surface white.
///
/// The brand hues are unchanged so the app still reads as itself, but the
/// SEMANTIC colours are darkened. #10B981 and #F59E0B are tuned for contrast
/// against a near-black surface and fail badly on white — an amber unread dot
/// on white is close to invisible.
const paletteLight = PaletteTokens(
  bgDeepest: Color(0xFFE4E6EB), // rail
  bgDark: Color(0xFFF0F2F5), // sidebar
  bgMain: Color(0xFFFFFFFF), // chat surface
  bgRaised: Color(0xFFF7F8FA), // composer, modals, cards
  bgHover: Color(0xFFE8EAEE),
  lineSubtle: Color(0xFFDCDFE4),
  lineStrong: Color(0xFFC4C9D0),
  ink: Color(0xFF14171C),
  inkMuted: Color(0xFF4B5563),
  inkDim: Color(0xFF6B7280), // legible on both, deliberately shared
  brand: Color(0xFF4752C4), // a touch deeper, for contrast on white
  brandHover: Color(0xFF3A44A8),
  brandSoft: Color(0x1F5865F2),
  ok: Color(0xFF0F9D6B),
  warn: Color(0xFFB45309),
  bad: Color(0xFFDC2626),
);

/// The app's colours, resolved through whichever set is active.
///
/// Deliberately still `Palette.bgMain` rather than a ThemeExtension read off
/// `context`. There are ~293 references across 37 files, and moving them all
/// to context lookups would be a large mechanical rewrite with no behavioural
/// gain — while this keeps every existing call site working. The cost is that
/// these are getters rather than compile-time constants, so the ~30 references
/// that sat inside `const` expressions had to drop their `const`.
///
/// [setMode] only swaps the token set; it does NOT rebuild anything. The app
/// watches `themeModeProvider` at the MaterialApp level, so changing the mode
/// rebuilds the tree from the root and every getter is re-read on the way down.
/// Anything that caches a Color across that rebuild would keep a stale value —
/// nothing does today, and this comment is here so it stays that way.
abstract final class Palette {
  static PaletteTokens _t = paletteDark;

  static bool get isLight => _t == paletteLight;

  static void setMode({required bool light}) {
    _t = light ? paletteLight : paletteDark;
  }

  static Color get bgDeepest => _t.bgDeepest;
  static Color get bgDark => _t.bgDark;
  static Color get bgMain => _t.bgMain;
  static Color get bgRaised => _t.bgRaised;
  static Color get bgHover => _t.bgHover;

  static Color get lineSubtle => _t.lineSubtle;
  static Color get lineStrong => _t.lineStrong;

  static Color get ink => _t.ink;
  static Color get inkMuted => _t.inkMuted;
  static Color get inkDim => _t.inkDim;

  static Color get brand => _t.brand;
  static Color get brandHover => _t.brandHover;
  static Color get brandSoft => _t.brandSoft;

  static Color get ok => _t.ok;
  static Color get warn => _t.warn;
  static Color get bad => _t.bad;
}
