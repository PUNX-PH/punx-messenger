import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'config/emulators.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Emulators.enabled is a --dart-define, so a normal build compiles this down
  // to the real branch. See config/emulators.dart for why the demo- project id
  // is what keeps a test run off the live workspace.
  await Firebase.initializeApp(
    options: Emulators.enabled
        ? Emulators.options
        : DefaultFirebaseOptions.currentPlatform,
  );
  await Emulators.connect();
  if (Emulators.enabled) {
    // Flutter web paints to a canvas, so there is no DOM to assert against.
    // Turning on the semantics tree mirrors the widget tree into
    // <flt-semantics> elements, which is what makes an emulator run
    // inspectable from outside. Emulator-only, like everything else behind
    // this flag.
    SemanticsBinding.instance.ensureSemantics();
  }
  runApp(const ProviderScope(child: PunxApp()));
}
