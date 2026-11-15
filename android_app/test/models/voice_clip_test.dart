import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/voice_clip.dart';

const _ok = 'data:audio/mp4;base64,AAAA';

void main() {
  group('isPlayableAudioUrl', () {
    test('a plain audio data address is playable', () {
      expect(isPlayableAudioUrl(_ok), isTrue);
      expect(isPlayableAudioUrl('data:audio/webm;codecs=opus;base64,AA+/AA=='), isTrue);
      expect(isPlayableAudioUrl('data:audio/mp4;codecs=mp4a.40.2;base64,AAAA'), isTrue);
      for (final t in ['webm', 'ogg', 'mp4', 'mpeg', 'aac', 'wav', 'x-m4a']) {
        expect(isPlayableAudioUrl('data:audio/$t;base64,AAAA'), isTrue, reason: t);
      }
    });

    test('anything fetched, not audio, not base64 or oddly written is refused', () {
      for (final u in <Object?>[
        'https://tracker.example/x.webm',
        'http://x.test/a.mp3',
        '//x.test/a',
        'blob:https://x/1',
        'javascript:alert(1)',
        'data:text/html;base64,AAAA',
        'data:image/png;base64,AAAA',
        'data:video/webm;base64,AAAA',
        'data:audio/webm,AAAA',
        'data:audio/webm;base64,',
        'data:audio/webm;base64,AA AA',
        'data:audio/webm;base64,AA\nAA',
        'data:audio/evil;base64,AAAA',
        'data:audio/webm;codecs=<x>;base64,AAAA',
        'DATA:audio/webm;base64,AAAA',
        ' data:audio/webm;base64,AAAA',
        'data:audio/webm;base64,AAAA ',
        'data:audio/webm;base64,AAAA\n',
        'x data:audio/webm;base64,AAAA',
        '',
        null,
        5,
        <String>['data:audio/webm;base64,AAAA'],
      ]) {
        expect(isPlayableAudioUrl(u), isFalse, reason: '$u');
      }
    });

    test('the size limit is exact', () {
      const head = 'data:audio/webm;base64,';
      expect(isPlayableAudioUrl(head + 'A' * (maxVoiceChars - head.length)), isTrue);
      expect(isPlayableAudioUrl(head + 'A' * (maxVoiceChars - head.length + 1)), isFalse);
    });
  });

  group('VoiceClip.fromFields', () {
    test('reads the address and the stored length', () {
      final c = VoiceClip.fromFields(_ok, {'durationMs': 7400})!;
      expect(c.dataUrl, _ok);
      expect(c.durationMs, 7400);
    });

    test('no length stored is unknown (0), not an error', () {
      expect(VoiceClip.fromFields(_ok, null)!.durationMs, 0);
      expect(VoiceClip.fromFields(_ok, 'x')!.durationMs, 0);
      expect(VoiceClip.fromFields(_ok, <String, dynamic>{})!.durationMs, 0);
    });

    test('a length is rounded and never above the limit; nonsense is 0', () {
      expect(VoiceClip.fromFields(_ok, {'durationMs': 7400.6})!.durationMs, 7401);
      expect(VoiceClip.fromFields(_ok, {'durationMs': 999999})!.durationMs, maxVoiceMs);
      expect(VoiceClip.fromFields(_ok, {'durationMs': maxVoiceMs})!.durationMs, maxVoiceMs);
      for (final d in <Object?>[-5, 0, double.nan, double.infinity, 'abc', null, <int>[]]) {
        expect(VoiceClip.fromFields(_ok, {'durationMs': d})!.durationMs, 0, reason: '$d');
      }
    });

    test('a message that is not a playable voice message gives none', () {
      for (final u in <Object?>[null, '', 'https://x.test/a.webm', 7, 'data:image/png;base64,AAAA']) {
        expect(VoiceClip.fromFields(u, {'durationMs': 1000}), isNull, reason: '$u');
      }
    });
  });

  group('VoiceClip', () {
    test('the type and the recording come out of the address', () {
      final c = VoiceClip.fromFields('data:audio/mp4;codecs=mp4a.40.2;base64,AQID', null)!;
      expect(c.mime, 'audio/mp4');
      expect(c.bytes, [1, 2, 3]);
      expect(VoiceClip.fromFields('data:audio/webm;base64,AQID', null)!.mime, 'audio/webm');
    });

    test('an iPhone cannot play WebM or Ogg, and can play the rest', () {
      bool plays(String t) => VoiceClip.fromFields('data:audio/$t;base64,AAAA', null)!.playsOnIPhone;
      expect(plays('webm'), isFalse);
      expect(plays('ogg'), isFalse);
      for (final t in ['mp4', 'mpeg', 'aac', 'wav', 'x-m4a']) {
        expect(plays(t), isTrue, reason: t);
      }
    });
  });

  group('formatVoiceDuration', () {
    test('reads as minutes and seconds to the nearest second', () {
      expect(formatVoiceDuration(0), '0:00');
      expect(formatVoiceDuration(7400), '0:07');
      expect(formatVoiceDuration(7600), '0:08');
      expect(formatVoiceDuration(65000), '1:05');
      expect(formatVoiceDuration(60000), '1:00');
      expect(formatVoiceDuration(599000), '9:59');
      for (final x in <num>[-1, double.nan, double.infinity]) {
        expect(formatVoiceDuration(x), '0:00', reason: '$x');
      }
    });
  });
}
