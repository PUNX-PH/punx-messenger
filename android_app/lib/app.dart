import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers/auth_providers.dart';
import 'providers/theme_providers.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';

class PunxApp extends ConsumerWidget {
  const PunxApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    // Watched, not read: this is what keeps the removal listener subscribed
    // for the app's lifetime. See removalWatcherProvider.
    ref.watch(removalWatcherProvider);
    final mode = ref.watch(themeModeProvider);
    return MaterialApp.router(
      // Keyed on the mode, and this is REQUIRED rather than tidy.
      //
      // Changing MaterialApp.theme does not rebuild the tree — it notifies
      // dependents of the Theme inherited widget. Most of this app reads
      // colours from `Palette.x` directly and never calls Theme.of(context),
      // so those widgets are not dependents: they kept whatever they last
      // painted while the theme around them changed. The result was a mix of
      // both palettes on screen at once — a light app bar and nav over dark
      // rows with dark-on-dark text.
      //
      // A new key forces the subtree to be rebuilt from scratch, so every
      // Palette getter is read again. The cost is losing transient widget
      // state (scroll offsets, open sheets) on a theme switch, which is an
      // acceptable trade for a deliberate, rare user action. The alternative
      // is moving all ~293 colour reads onto a ThemeExtension resolved through
      // context, which is the idiomatic fix and a much larger change.
      key: ValueKey(mode),
      title: 'Punx Messenger',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(light: mode == ThemeMode.light),
      routerConfig: router,
    );
  }
}
