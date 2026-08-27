import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers/auth_providers.dart';
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
    return MaterialApp.router(
      title: 'Punx Messenger',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      routerConfig: router,
    );
  }
}
