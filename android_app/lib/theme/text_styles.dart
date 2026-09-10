import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'palette.dart';

/// Font scale ported from tailwind.config.js's custom fontSize overrides.
abstract final class AppTextStyles {
  static TextStyle _inter(
    double size,
    double height,
    FontWeight weight,
    Color color,
  ) {
    return GoogleFonts.inter(
      fontSize: size,
      height: height / size,
      fontWeight: weight,
      color: color,
    );
  }

  static TextStyle xs({
    Color? color,
    FontWeight weight = FontWeight.w400,
  }) => _inter(12, 16, weight, color ?? Palette.ink);

  static TextStyle sm({
    Color? color,
    FontWeight weight = FontWeight.w400,
  }) => _inter(13, 18.4, weight, color ?? Palette.ink);

  static TextStyle base({
    Color? color,
    FontWeight weight = FontWeight.w400,
  }) => _inter(15, 22.4, weight, color ?? Palette.ink);

  static TextStyle lg({
    Color? color,
    FontWeight weight = FontWeight.w600,
  }) => _inter(17, 24, weight, color ?? Palette.ink);
}
