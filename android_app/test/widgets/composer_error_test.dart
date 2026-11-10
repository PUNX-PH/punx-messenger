import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/widgets/chat/composer.dart';

// What someone sees under the message box when sending fails. The screenshot that
// started this was the raw "[cloud_firestore/permission-denied] The caller does not
// have permission to execute the specified operation."
Widget host(ComposerSend onSend) => MaterialApp(
  home: Scaffold(
    body: Align(
      alignment: Alignment.bottomCenter,
      child: Composer(placeholder: 'Message', onSend: onSend, users: const []),
    ),
  ),
);

Future<void> sendHi(WidgetTester tester) async {
  await tester.enterText(find.byType(TextField), 'hi');
  await tester.pump();
  await tester.tap(find.byIcon(Icons.send));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets(
    'a refused send says what failed and what to do, not the raw code',
    (tester) async {
      await tester.pumpWidget(
        host(({
          required text,
          imageBytes,
          imageName,
          remoteImageUrl,
          remoteImageMeta,
        }) async {
          throw FirebaseException(
            plugin: 'cloud_firestore',
            code: 'permission-denied',
            message:
                'The caller does not have permission to execute the specified operation.',
          );
        }),
      );
      await sendHi(tester);

      expect(
        find.textContaining("You don't have permission to send that message"),
        findsOneWidget,
      );
      expect(find.textContaining('sign out and back in'), findsOneWidget);
      expect(find.textContaining('(permission-denied)'), findsOneWidget);
      expect(find.textContaining('[cloud_firestore'), findsNothing);
      expect(
        find.textContaining('The caller does not have permission'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'no connection says so, and keeps what was typed so it can be retried',
    (tester) async {
      await tester.pumpWidget(
        host(({
          required text,
          imageBytes,
          imageName,
          remoteImageUrl,
          remoteImageMeta,
        }) async {
          throw FirebaseException(
            plugin: 'cloud_firestore',
            code: 'unavailable',
          );
        }),
      );
      await sendHi(tester);

      expect(find.textContaining("Couldn't reach the server"), findsOneWidget);
      expect(
        find.text('hi'),
        findsOneWidget,
        reason: 'the text is still in the box',
      );
    },
  );

  testWidgets('a message the app wrote itself is shown as written', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(({
        required text,
        imageBytes,
        imageName,
        remoteImageUrl,
        remoteImageMeta,
      }) async {
        throw StateError('That message is too long.');
      }),
    );
    await sendHi(tester);

    expect(find.text('That message is too long.'), findsOneWidget);
    expect(find.textContaining('Bad state'), findsNothing);
  });
}
