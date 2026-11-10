import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/widgets/chat/reaction_chip.dart';

Widget host(Map<String, List<String>> reactions, {VoidCallback? onAdd}) =>
    MaterialApp(
      home: Scaffold(
        body: ReactionChips(
          reactions: reactions,
          meUid: 'me',
          emojiByName: const {},
          onToggle: (_) {},
          onAddReaction: onAdd ?? () {},
        ),
      ),
    );

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets('a message with no reactions shows nothing at all under it', (
    tester,
  ) async {
    await tester.pumpWidget(host(const {}));
    expect(find.byIcon(Icons.add_reaction_outlined), findsNothing);
    expect(tester.getSize(find.byType(ReactionChips)), Size.zero);
  });

  testWidgets('reactions that were all removed (empty lists) count as none', (
    tester,
  ) async {
    await tester.pumpWidget(host(const {'👍': [], '🎉': []}));
    expect(find.byIcon(Icons.add_reaction_outlined), findsNothing);
    expect(tester.getSize(find.byType(ReactionChips)), Size.zero);
  });

  testWidgets('once there is a reaction, its chip and the add button appear', (
    tester,
  ) async {
    var added = 0;
    await tester.pumpWidget(
      host(const {
        '👍': ['ana', 'me'],
      }, onAdd: () => added++),
    );
    expect(find.text('👍'), findsWidgets);
    expect(find.byIcon(Icons.add_reaction_outlined), findsOneWidget);
    await tester.tap(find.byIcon(Icons.add_reaction_outlined));
    expect(added, 1);
  });

  testWidgets('one reaction among emptied ones still shows', (tester) async {
    await tester.pumpWidget(
      host(const {
        '👍': [],
        '🎉': ['ana'],
      }),
    );
    expect(find.text('🎉'), findsWidgets);
    expect(find.byIcon(Icons.add_reaction_outlined), findsOneWidget);
  });
}
