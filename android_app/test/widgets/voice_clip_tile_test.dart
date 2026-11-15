import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/voice_clip.dart';
import 'package:punx_messenger/providers/presence_providers.dart';
import 'package:punx_messenger/providers/voice_playback_providers.dart';
import 'package:punx_messenger/services/voice_playback.dart';
import 'package:punx_messenger/widgets/chat/message_row.dart';
import 'package:punx_messenger/widgets/chat/voice_clip_tile.dart';

import '../support/fake_voice_backend.dart';

Map<String, dynamic> _doc({
  String? text,
  Object? audioURL = 'data:audio/mp4;base64,AQID',
  Object? audioMeta = const {'durationMs': 8000},
}) => {
  'text': text ?? '',
  'audioURL': audioURL,
  'audioMeta': audioMeta,
  'author': {'uid': 'ana', 'name': 'Ana'},
};

final _liveFlag = StateProvider<bool>((_) => false);

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);
  tearDown(() {
    VoiceClipController.forgetCurrent();
    debugDefaultTargetPlatformOverride = null;
  });

  Future<List<FakeBackend>> pumpRow(
    WidgetTester tester,
    ChatMessage message, {
    bool live = false,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final made = <FakeBackend>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          statusOfProvider.overrideWith((ref, uid) => 'online'),
          _liveFlag.overrideWith((_) => live),
          liveAudioProvider.overrideWith((ref) => ref.watch(_liveFlag)),
          voicePlayerFactoryProvider.overrideWithValue(() {
            final b = FakeBackend();
            made.add(b);
            return b;
          }),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: MessageRow(
              message: message,
              showHeader: true,
              meUid: 'me',
              usersById: const {},
              emojiByName: const {},
              canDeleteAny: false,
            ),
          ),
        ),
      ),
    );
    return made;
  }

  Finder play() => find.byIcon(Icons.play_arrow);
  Finder pause() => find.byIcon(Icons.pause);

  testWidgets('a voice message shows a play button and its length', (tester) async {
    await pumpRow(tester, ChatMessage.fromMap('m1', _doc()));
    expect(find.byType(VoiceClipTile), findsOneWidget);
    expect(play(), findsOneWidget);
    expect(find.text('0:08'), findsOneWidget);
  });

  testWidgets('a message with no voice message has no player', (tester) async {
    await pumpRow(tester, ChatMessage.fromMap('m1', _doc(text: 'hello', audioURL: null)));
    expect(find.byType(VoiceClipTile), findsNothing);
    expect(find.text('hello', findRichText: true), findsOneWidget);
  });

  testWidgets('an address that is not audio data shows no player at all', (tester) async {
    await pumpRow(tester, ChatMessage.fromMap('m1', _doc(text: 'hi', audioURL: 'https://evil.test/a.mp3')));
    expect(find.byType(VoiceClipTile), findsNothing);
  });

  testWidgets('tapping play plays, the button turns to pause, and the time shows progress', (tester) async {
    final made = await pumpRow(tester, ChatMessage.fromMap('m1', _doc()));
    await tester.tap(play());
    await tester.pump();
    expect(made.single.log, ['load audio/mp4', 'play']);
    expect(pause(), findsOneWidget);
    made.single.position.add(const Duration(seconds: 3));
    await tester.pump();
    expect(find.text('0:03 / 0:08'), findsOneWidget);
    await tester.tap(pause());
    await tester.pump();
    expect(play(), findsOneWidget);
  });

  testWidgets('dragging the slider moves the player', (tester) async {
    final made = await pumpRow(tester, ChatMessage.fromMap('m1', _doc()));
    final slider = find.byType(Slider);
    await tester.tapAt(tester.getCenter(slider));
    await tester.pump();
    expect(made.single.log.last, startsWith('seek '));
    final to = int.parse(made.single.log.last.split(' ')[1]);
    expect(to, inInclusiveRange(3000, 5000), reason: 'the middle of an 8 s recording');
  });

  testWidgets('during a call or a voice channel it does not play, and says why', (tester) async {
    final made = await pumpRow(tester, ChatMessage.fromMap('m1', _doc()), live: true);
    await tester.tap(play());
    await tester.pump();
    expect(made, isEmpty);
    expect(find.text('Leave the call to listen to voice messages.'), findsOneWidget);
    expect(play(), findsOneWidget);
  });

  testWidgets('one that is playing can still be paused when a call starts', (tester) async {
    final made = await pumpRow(tester, ChatMessage.fromMap('m1', _doc()));
    await tester.tap(play());
    await tester.pump();
    ProviderScope.containerOf(tester.element(find.byType(MessageRow))).read(_liveFlag.notifier).state = true;
    await tester.pump();
    await tester.tap(pause());
    await tester.pump();
    expect(made.single.log.last, 'pause');
    expect(find.text('Leave the call to listen to voice messages.'), findsNothing);
  });

  testWidgets('a recording the player cannot read says "Can\'t play"', (tester) async {
    final made = <FakeBackend>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          statusOfProvider.overrideWith((ref, uid) => 'online'),
          liveAudioProvider.overrideWithValue(false),
          voicePlayerFactoryProvider.overrideWithValue(() {
            final b = FakeBackend()..loadError = StateError('format');
            made.add(b);
            return b;
          }),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: VoiceClipTile(clip: VoiceClip.fromFields('data:audio/mp4;base64,AQID', null)!),
          ),
        ),
      ),
    );
    await tester.tap(play());
    await tester.pump();
    await tester.pump();
    expect(find.text("Can't play"), findsOneWidget);
    expect(play(), findsNothing);
  });

  testWidgets('on an iPhone a WebM recording says "Can\'t play" without trying', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      final made = await pumpRow(
        tester,
        ChatMessage.fromMap('m1', _doc(audioURL: 'data:audio/webm;codecs=opus;base64,AQID')),
      );
      expect(find.text("Can't play"), findsOneWidget);
      expect(made, isEmpty);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('on an iPhone an MP4 recording plays', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      final made = await pumpRow(tester, ChatMessage.fromMap('m1', _doc()));
      await tester.tap(play());
      await tester.pump();
      expect(made.single.log, ['load audio/mp4', 'play']);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  group('ChatMessage', () {
    test('a voice message is read from the message, and only a playable one', () {
      expect(ChatMessage.fromMap('a', _doc()).voice?.durationMs, 8000);
      expect(ChatMessage.fromMap('a', _doc(audioURL: 'https://x.test/a.mp3')).voice, isNull);
      expect(ChatMessage.fromMap('a', {'text': 'x'}).voice, isNull);
    });

    test('it stays on the message when the message is pinned', () {
      final m = ChatMessage.fromMap('a', _doc());
      expect(m.copyWith(pinned: true).voice, same(m.voice));
    });

    test('the words that stand for a message', () {
      expect(ChatMessage.fromMap('a', _doc(text: 'hi')).previewText, 'hi');
      expect(ChatMessage.fromMap('a', _doc()).previewText, '[voice message]');
      expect(
        ChatMessage.fromMap('a', {..._doc(), 'imageURL': 'data:image/png;base64,AA'}).previewText,
        '[image]',
      );
      expect(ChatMessage.fromMap('a', {'text': ''}).previewText, '');
      expect(ChatMessage.fromMap('a', _doc(text: 'hi', audioURL: null)).previewText, 'hi');
    });
  });
}
