import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/palette.dart';

/// Light or dark, remembered across launches.
///
/// Stored locally rather than on the user's Firestore document, deliberately:
/// this is a property of the device you are reading on, not of the account.
/// The same person on a phone and a desktop can reasonably want different
/// answers, and a Firestore round trip would also mean the app opened in the
/// wrong theme and then flipped.
///
/// Dark is the default, and stays the default — the app was dark-only until
/// now, so anyone who never touches this sees no change.
class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController() : super(ThemeMode.dark) {
    _load();
  }

  static const _key = 'themeMode';

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_key);
      if (saved == 'light') _apply(ThemeMode.light);
    } catch (_) {
      // A preferences failure must not stop the app opening; dark stands.
    }
  }

  Future<void> setMode(ThemeMode mode) async {
    _apply(mode);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, mode == ThemeMode.light ? 'light' : 'dark');
    } catch (_) {
      // The choice still applies for this session.
    }
  }

  void toggle() =>
      setMode(state == ThemeMode.light ? ThemeMode.dark : ThemeMode.light);

  /// Palette is swapped BEFORE the state changes, so that when listeners
  /// rebuild, every `Palette.x` getter they read already returns the new
  /// value. The other order would paint one frame in the old colours.
  void _apply(ThemeMode mode) {
    Palette.setMode(light: mode == ThemeMode.light);
    state = mode;
  }
}

final themeModeProvider =
    StateNotifierProvider<ThemeModeController, ThemeMode>(
  (ref) => ThemeModeController(),
);
