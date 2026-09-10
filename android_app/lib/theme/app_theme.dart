import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'palette.dart';

/// Radii ported 1:1 from tailwind.config.js's custom borderRadius scale.
abstract final class AppRadii {
  static const xs = 4.0;
  static const sm = 6.0;
  static const md = 8.0;
  static const lg = 12.0;
}

/// The two elevation shadows used throughout the web app ("elev1"/"elev2").
abstract final class AppShadows {
  static const elev1 = [
    BoxShadow(color: Color(0x33000000), offset: Offset(0, 1)),
    BoxShadow(color: Color(0x33000000), offset: Offset(0, 2), blurRadius: 4),
  ];

  static const elev2 = [
    BoxShadow(color: Color(0x52000000), offset: Offset(0, 4), blurRadius: 16),
  ];
}

/// Built for whichever palette is active. Every colour below already resolves
/// through a `Palette` getter, so switching mode is a matter of the Material
/// base and the ColorScheme brightness — the tokens themselves are swapped by
/// [ThemeModeController] before this runs.
ThemeData buildAppTheme({bool light = false}) {
  final base = light
      ? ThemeData.light(useMaterial3: true)
      : ThemeData.dark(useMaterial3: true);
  final textTheme = GoogleFonts.interTextTheme(
    base.textTheme,
  ).apply(bodyColor: Palette.ink, displayColor: Palette.ink);

  return base.copyWith(
    scaffoldBackgroundColor: Palette.bgMain,
    canvasColor: Palette.bgMain,
    textTheme: textTheme,
    colorScheme: base.colorScheme.copyWith(
      brightness: light ? Brightness.light : Brightness.dark,
      primary: Palette.brand,
      onPrimary: Colors.white,
      secondary: Palette.brand,
      surface: Palette.bgRaised,
      onSurface: Palette.ink,
      error: Palette.bad,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: Palette.bgMain,
      foregroundColor: Palette.ink,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
    ),
    bottomNavigationBarTheme: BottomNavigationBarThemeData(
      backgroundColor: Palette.bgDark,
      selectedItemColor: Palette.brand,
      unselectedItemColor: Palette.inkDim,
      type: BottomNavigationBarType.fixed,
    ),
    dividerTheme: DividerThemeData(
      color: Palette.lineSubtle,
      thickness: 1,
      space: 1,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Palette.bgDeepest,
      hintStyle: TextStyle(color: Palette.inkDim),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.md),
        borderSide: BorderSide(color: Palette.lineSubtle),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.md),
        borderSide: BorderSide(color: Palette.lineSubtle),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.md),
        borderSide: BorderSide(color: Palette.brand),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: Palette.brand,
        foregroundColor: Colors.white,
        disabledBackgroundColor: Palette.brand.withValues(alpha: 0.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: Palette.bgRaised,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.lg)),
      ),
    ),
    cardTheme: CardThemeData(
      color: Palette.bgRaised,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.md),
        side: BorderSide(color: Palette.lineSubtle),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Palette.bgRaised,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.lg),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: Palette.bgHover,
      contentTextStyle: TextStyle(color: Palette.ink),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
    ),
  );
}
