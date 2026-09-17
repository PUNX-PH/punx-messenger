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

/// The vertical rhythm everything measures against.
///
/// Padding used to be picked per screen, which is how a list ends up on 14 and
/// the sheet below it on 15 — invisible individually, and collectively the
/// reason a layout reads as approximate. A 4dp base with no values between the
/// steps makes the wrong spacing awkward to write.
///
/// [gutter] is the screen edge and deliberately equals [lg]: it is quoted
/// separately because it answers a different question from "space between two
/// things", and changing one should not silently change the other.
abstract final class AppSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;

  static const gutter = lg;

  /// Android's floor for anything you touch. Rows shorter than this stay
  /// tappable by padding the gesture target, not by growing the visual.
  static const minTouch = 48.0;
}

/// Material 3's easing and duration sets, named so call sites stop inventing
/// their own. The app had no motion tokens at all, so every animated widget
/// fell back to Flutter's defaults — `Curves.linear` in the places that took
/// no argument, which is the one curve nothing physical does.
///
/// Durations are short on purpose. This is a messenger: motion is here to show
/// where a thing came from, and anything long enough to notice is long enough
/// to wait for on the fiftieth repeat.
abstract final class AppMotion {
  /// Selection, hovers, state flips — anything the user should not have to
  /// wait on.
  static const quick = Duration(milliseconds: 120);

  /// The default. Sheet and page transitions, list reorders.
  static const standard = Duration(milliseconds: 240);

  /// Reserved for a transform large enough that speed would read as a jump.
  static const emphasised = Duration(milliseconds: 400);

  /// M3 standard easing: decisive start, settled finish.
  static const curve = Cubic(0.2, 0.0, 0.0, 1.0);

  /// For something entering the screen, which should arrive rather than land.
  static const enter = Cubic(0.0, 0.0, 0.0, 1.0);

  /// For something leaving, which should commit immediately.
  static const exit = Cubic(0.3, 0.0, 1.0, 1.0);

  /// Honours the system "remove animations" accessibility setting, which is a
  /// real setting real people turn on — and which an app that hardcodes its
  /// durations ignores completely.
  static Duration of(BuildContext context, [Duration d = standard]) =>
      MediaQuery.maybeDisableAnimationsOf(context) ?? false ? Duration.zero : d;
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
/// Material's type scale is specified for Roboto, and Inter is not Roboto.
///
/// Sizes are left exactly where Material puts them — they are the contract the
/// rest of the app and the web build both read. What changes is tracking and
/// weight, which Roboto's metrics bake in and Inter's do not:
///
///   * Inter runs wide. At title sizes and up, Material's tracking adds to a
///     face that already has enough, and headings read as set by nobody. They
///     get negative tracking, increasing with size.
///   * Inter's lowercase is tall, so small text stays legible while looking
///     crowded. Labels and captions get positive tracking instead.
///   * Regular-vs-medium is the only weight contrast Material's scale asks
///     for, which flattens a list where the name and the preview line sit at
///     the same size. Titles go to 600 so hierarchy survives without a size
///     change that would break parity with the web.
TextTheme _tuneForInter(TextTheme t) {
  TextStyle? track(TextStyle? s, double spacing, [FontWeight? weight]) =>
      s?.copyWith(letterSpacing: spacing, fontWeight: weight ?? s.fontWeight);

  return t.copyWith(
    displayLarge: track(t.displayLarge, -1.5, FontWeight.w700),
    displayMedium: track(t.displayMedium, -1.0, FontWeight.w700),
    displaySmall: track(t.displaySmall, -0.75, FontWeight.w700),
    headlineLarge: track(t.headlineLarge, -0.75, FontWeight.w700),
    headlineMedium: track(t.headlineMedium, -0.5, FontWeight.w600),
    headlineSmall: track(t.headlineSmall, -0.4, FontWeight.w600),
    // Screen titles. The app bar is the most-read text in the app.
    titleLarge: track(t.titleLarge, -0.3, FontWeight.w600),
    // Names in a list, channel rows, sheet headers.
    titleMedium: track(t.titleMedium, -0.1, FontWeight.w600),
    titleSmall: track(t.titleSmall, 0, FontWeight.w600),
    // Message bodies. Tracking stays at zero: this is the one place where the
    // face should behave exactly as drawn.
    bodyLarge: track(t.bodyLarge, 0),
    bodyMedium: track(t.bodyMedium, 0),
    // Timestamps, member counts, the "DIRECT MESSAGES — 19" rail.
    bodySmall: track(t.bodySmall, 0.15),
    labelLarge: track(t.labelLarge, 0.1, FontWeight.w600),
    labelMedium: track(t.labelMedium, 0.4, FontWeight.w600),
    labelSmall: track(t.labelSmall, 0.6, FontWeight.w600),
  );
}

ThemeData buildAppTheme({bool light = false}) {
  final base = light
      ? ThemeData.light(useMaterial3: true)
      : ThemeData.dark(useMaterial3: true);
  final textTheme = _tuneForInter(
    GoogleFonts.interTextTheme(
      base.textTheme,
    ).apply(bodyColor: Palette.ink, displayColor: Palette.ink),
  );

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
      // The bar's job here is to name a conversation, and the names are real
      // ones: "Clarence Matthew Gaspar", not "Inbox". Material's 22sp
      // titleLarge is sized for short screen titles and spends the width on
      // letterforms that a person's name then loses.
      //
      // 20sp with the leading gap closed buys roughly four more characters,
      // which is the difference between a name and a stub. Moving the two
      // secondary actions to an overflow (see ChatSurface) bought the rest.
      // Long names still truncate — thirteen characters is not a solvable
      // width on a 360dp bar — but they truncate late instead of immediately.
      titleSpacing: AppSpacing.sm,
      titleTextStyle: textTheme.titleLarge?.copyWith(fontSize: 20),
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
