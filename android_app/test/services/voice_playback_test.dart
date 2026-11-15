import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/voice_clip.dart';
import 'package:punx_messenger/services/voice_playback.dart';

import '../support/fake_voice_backend.dart';

VoiceClip clip({String type = 'mp4', int ms = 8000}) =>
    VoiceClip.fromFields('data:audio/$type;base64,AQID', {'durationMs': ms})!;

({VoiceClipController c, List<FakeBackend> made}) make({
  VoiceClip? c,
  bool iphone = false,
  FakeBackend Function()? build,
}) {
  final made = <FakeBackend>[];
  final controller = VoiceClipController(c ?? clip(), () {
    final b = build?.call() ?? FakeBackend();
    made.add(b);
    return b;
  }, isIPhone: iphone);
  return (c: controller, made: made);
}

void main() {
  tearDown(VoiceClipController.forgetCurrent);

  test('before it is played it has made no player and shows the stored length', () {
    final m = make();
    expect(m.made, isEmpty);
    expect(m.c.playing, isFalse);
    expect(m.c.failed, isFalse);
    expect(m.c.position, Duration.zero);
    expect(m.c.total, const Duration(seconds: 8));
  });

  test('play hands the recording over, then plays it', () async {
    final m = make();
    await m.c.toggle();
    expect(m.made.single.log, ['load audio/mp4', 'play']);
    expect(m.c.playing, isTrue);
  });

  test('a second tap pauses, a third resumes on the same player', () async {
    final m = make();
    await m.c.toggle();
    await m.c.toggle();
    expect(m.c.playing, isFalse);
    await m.c.toggle();
    expect(m.c.playing, isTrue);
    expect(m.made, hasLength(1));
    expect(m.made.single.log, ['load audio/mp4', 'play', 'pause', 'play']);
  });

  test('position follows the player, and the file\'s own length replaces the stored one', () async {
    final m = make();
    await m.c.toggle();
    m.made.single.position.add(const Duration(seconds: 3));
    expect(m.c.position, const Duration(seconds: 3));
    m.made.single.duration.add(const Duration(milliseconds: 7500));
    expect(m.c.total, const Duration(milliseconds: 7500));
    m.made.single.duration.add(Duration.zero); // a recorder that cannot say
    expect(m.c.total, const Duration(milliseconds: 7500), reason: 'a zero length is not a length');
  });

  test('reaching the end stops it and goes back to the start', () async {
    final m = make();
    await m.c.toggle();
    m.made.single.position.add(const Duration(seconds: 8));
    m.made.single.completed.add(null);
    expect(m.c.playing, isFalse);
    expect(m.c.position, Duration.zero);
    expect(VoiceClipController.current, isNull);
  });

  test('starting another message stops the first and takes it back to the start', () async {
    final a = make();
    final b = make();
    await a.c.toggle();
    a.made.single.position.add(const Duration(seconds: 2));
    await b.c.toggle();
    expect(a.c.playing, isFalse);
    expect(a.c.position, Duration.zero);
    expect(a.made.single.log, ['load audio/mp4', 'play', 'pause', 'seek 0']);
    expect(b.c.playing, isTrue);
    expect(VoiceClipController.current, b.c);
  });

  test('pausing one does not leave it as the one that is playing', () async {
    final a = make();
    await a.c.toggle();
    expect(VoiceClipController.current, a.c);
    await a.c.toggle();
    expect(VoiceClipController.current, isNull);
  });

  test('a recording the phone cannot read is "failed", and its player is let go', () async {
    final m = make(build: () => FakeBackend()..loadError = StateError('format'));
    await m.c.toggle();
    expect(m.c.failed, isTrue);
    expect(m.c.playing, isFalse);
    expect(m.made.single.disposed, isTrue);
    expect(VoiceClipController.current, isNull);
    await m.c.toggle(); // nothing more happens
    expect(m.made, hasLength(1));
  });

  test('a player that will not start is "failed" too', () async {
    final m = make(build: () => FakeBackend()..playError = StateError('no'));
    await m.c.toggle();
    expect(m.c.failed, isTrue);
    expect(m.made.single.disposed, isTrue);
  });

  test('an iPhone does not even try WebM or Ogg, and plays the rest', () async {
    for (final t in ['webm', 'ogg']) {
      final m = make(c: clip(type: t), iphone: true);
      expect(m.c.failed, isTrue, reason: t);
      await m.c.toggle();
      expect(m.made, isEmpty, reason: t);
    }
    final ok = make(iphone: true);
    expect(ok.c.failed, isFalse);
    await ok.c.toggle();
    expect(ok.c.playing, isTrue);
    // and Android tries WebM
    final droid = make(c: clip(type: 'webm'));
    expect(droid.c.failed, isFalse);
    await droid.c.toggle();
    expect(droid.made.single.log.first, 'load audio/webm');
  });

  test('seeking moves the player, clamped to the recording', () async {
    final m = make();
    await m.c.seek(const Duration(seconds: 3));
    expect(m.c.position, const Duration(seconds: 3));
    expect(m.made.single.log, ['load audio/mp4', 'seek 3000']);
    await m.c.seek(const Duration(seconds: 99));
    expect(m.c.position, const Duration(seconds: 8));
    await m.c.seek(const Duration(seconds: -4));
    expect(m.c.position, Duration.zero);
    expect(m.made, hasLength(1), reason: 'one player, opened once');
  });

  test('when the length is not known, seeking is not clamped to nothing', () async {
    final m = make(c: clip(ms: 0));
    await m.c.seek(const Duration(seconds: 3));
    expect(m.c.position, const Duration(seconds: 3));
  });

  test('a seek the player refuses is "failed"', () async {
    final m = make(build: () => FakeBackend()..seekError = StateError('no'));
    await m.c.seek(const Duration(seconds: 1));
    expect(m.c.failed, isTrue);
    expect(m.made.single.disposed, isTrue);
  });

  test('a failed one cannot be seeked', () async {
    final m = make(c: clip(type: 'webm'), iphone: true);
    await m.c.seek(const Duration(seconds: 1));
    expect(m.made, isEmpty);
  });

  test('going away lets the player go, and it is no longer the one playing', () async {
    final m = make();
    await m.c.toggle();
    m.c.dispose();
    await Future<void>.delayed(Duration.zero);
    expect(m.made.single.disposed, isTrue);
    expect(VoiceClipController.current, isNull);
    // a late word from the player after that changes nothing and does not throw
    m.made.single.position.add(const Duration(seconds: 1));
  });

  test('going away while a failed one is being let go does not trip over itself', () async {
    final m = make(build: () => FakeBackend()..loadError = StateError('format'));
    final pending = m.c.toggle(); // fails at the load...
    m.c.dispose(); // ...as the screen goes away: two releases at once
    await pending;
    await Future<void>.delayed(Duration.zero);
    expect(m.made.single.disposed, isTrue);
  });

  test('every change tells the screen', () async {
    final m = make();
    var n = 0;
    m.c.addListener(() => n++);
    await m.c.toggle();
    expect(n, greaterThan(0));
    final before = n;
    m.made.single.position.add(const Duration(seconds: 1));
    expect(n, before + 1);
  });
}
