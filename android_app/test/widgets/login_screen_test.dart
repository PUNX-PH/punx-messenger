import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/screens/login_screen.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  const sizes = <String, Size>{
    'small phone 320x568': Size(320, 568),
    'phone 390x844': Size(390, 844),
    'phone landscape 844x390': Size(844, 390),
    'small landscape 568x320': Size(568, 320),
    'tablet 768x1024': Size(768, 1024),
    'tablet landscape 1280x800': Size(1280, 800),
  };

  for (final entry in sizes.entries) {
    for (final scale in const [1.0, 2.0]) {
      testWidgets('login fits ${entry.key} at ${scale}x text', (tester) async {
        tester.view.physicalSize = entry.value;
        tester.view.devicePixelRatio = 1.0;
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.view.reset);
        addTearDown(tester.platformDispatcher.clearAllTestValues);

        await tester.pumpWidget(
          const ProviderScope(child: MaterialApp(home: LoginScreen())),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(find.text('Punx Messenger'), findsOneWidget);
        // The button must stay reachable even when the column is taller than
        // the screen: it scrolls rather than clipping.
        await tester.ensureVisible(find.text('Continue with Google'));
        await tester.pumpAndSettle();
        expect(find.text('Continue with Google'), findsOneWidget);
      });
    }
  }

  testWidgets('the wordmark tile is announced as "Punx"', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: LoginScreen())),
    );
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel('Punx'), findsOneWidget);
  });
}
