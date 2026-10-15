import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/services/sfx_service.dart';

class _FakeBackend implements SfxBackend {
  final started = <Sfx>[];
  final stopped = <Sfx>[];
  int inits = 0;
  bool failInit = false;
  bool failStart = false;

  @override
  Future<void> init() async {
    inits++;
    if (failInit) throw StateError('no audio device');
  }

  @override
  Future<void> start(Sfx sfx) async {
    if (failStart) throw StateError('player error');
    started.add(sfx);
  }

  @override
  Future<void> stop(Sfx sfx) async => stopped.add(sfx);
}

void main() {
  late _FakeBackend backend;
  late DateTime clock;
  late SfxService sfx;

  Future<void> ready() => sfx.init();
  void advance(int ms) => clock = clock.add(Duration(milliseconds: ms));

  setUp(() {
    backend = _FakeBackend();
    clock = DateTime(2026, 10, 15, 12);
    sfx = SfxService(backend, now: () => clock);
  });

  group('starting up', () {
    test('nothing plays before the sounds are ready', () async {
      sfx.play(Sfx.dmPing);
      expect(backend.started, isEmpty);
      await ready();
      sfx.play(Sfx.dmPing);
      expect(backend.started, [Sfx.dmPing]);
    });

    test('init runs once, however often it is asked for', () async {
      await ready();
      await ready();
      expect(backend.inits, 1);
    });

    test('a device with no audio leaves the app working, and silent', () async {
      backend.failInit = true;
      await expectLater(ready(), completes);
      expect(sfx.ready, isFalse);
      expect(() => sfx.play(Sfx.ring), returnsNormally);
      expect(backend.started, isEmpty);
    });

    test('a player error never reaches the caller', () async {
      await ready();
      backend.failStart = true;
      expect(() => sfx.play(Sfx.voiceJoin), returnsNormally);
      await Future<void>.delayed(
        Duration.zero,
      ); // let the swallowed error settle
    });
  });

  group('throttling', () {
    setUp(() => ready());

    test('a burst is one sound, and it resumes after the gap', () {
      sfx.play(Sfx.peerJoin);
      sfx.play(Sfx.peerJoin);
      sfx.play(Sfx.peerJoin);
      expect(backend.started, [
        Sfx.peerJoin,
      ], reason: '30 joiners is not 30 chimes');
      advance(400);
      sfx.play(Sfx.peerJoin);
      expect(backend.started, [Sfx.peerJoin, Sfx.peerJoin]);
    });

    test('is per sound: a join and a leave together both play', () {
      sfx.play(Sfx.peerJoin);
      sfx.play(Sfx.peerLeave);
      expect(backend.started, [Sfx.peerJoin, Sfx.peerLeave]);
    });

    test('your own join/leave chimes and calls are never throttled', () {
      sfx.play(Sfx.voiceJoin);
      sfx.play(Sfx.voiceJoin);
      sfx.play(Sfx.callConnected);
      sfx.play(Sfx.callConnected);
      expect(backend.started, hasLength(4));
    });

    test('pings are spaced out', () {
      sfx.play(Sfx.dmPing);
      advance(200);
      sfx.play(Sfx.dmPing);
      expect(backend.started, hasLength(1));
      advance(400);
      sfx.play(Sfx.dmPing);
      expect(backend.started, hasLength(2));
    });
  });

  group('on and off', () {
    setUp(() => ready());

    test('off means nothing plays', () {
      sfx.setEnabled(false);
      sfx.play(Sfx.ring);
      sfx.play(Sfx.dmPing);
      expect(backend.started, isEmpty);
    });

    test('turning it off stops everything that is sounding', () async {
      sfx.play(Sfx.ring);
      sfx.setEnabled(false);
      await Future<void>.delayed(Duration.zero);
      expect(backend.stopped, containsAll(Sfx.values));
    });

    test(
      'back on, sounds play again — but a ring missed while off stays missed',
      () {
        sfx.setEnabled(false);
        sfx.play(Sfx.ring); // the call arrived while sound was off
        sfx.setEnabled(true);
        expect(backend.started, isEmpty, reason: 'it must not start late');
        sfx.play(Sfx.dmPing);
        expect(backend.started, [Sfx.dmPing]);
      },
    );
  });

  test('stop() reaches the backend', () async {
    await ready();
    await sfx.stop(Sfx.ring);
    expect(backend.stopped, [Sfx.ring]);
  });

  group('the sounds themselves', () {
    // Tests run from android_app/, with the repo root one level up.
    File asset(Sfx s) => File(s.bundledPath);
    File web(Sfx s) => File('../public/sfx/${s.file}.wav');

    test('every sound has a bundled file, and it is a real WAV', () {
      for (final s in Sfx.values) {
        expect(
          asset(s).existsSync(),
          isTrue,
          reason: '${s.bundledPath} missing',
        );
        final b = asset(s).readAsBytesSync();
        expect(String.fromCharCodes(b.sublist(0, 4)), 'RIFF', reason: s.file);
        expect(String.fromCharCodes(b.sublist(8, 12)), 'WAVE', reason: s.file);
        expect(b.length, greaterThan(1000), reason: s.file);
      }
    });

    test('no stray file is bundled that the app does not know about', () {
      final onDisk = Directory('assets/sfx')
          .listSync()
          .map((e) => e.uri.pathSegments.last.replaceAll('.wav', ''))
          .toSet();
      expect(onDisk, Sfx.values.map((s) => s.file).toSet());
    });

    test('the app plays exactly what the web plays', () {
      // One generator writes both copies; a stale one means the apps sound
      // different from each other.
      for (final s in Sfx.values) {
        expect(
          asset(s).readAsBytesSync(),
          web(s).readAsBytesSync(),
          reason: '${s.file}.wav differs between assets/sfx and public/sfx',
        );
      }
    });

    test('pubspec bundles the folder', () {
      expect(
        File('pubspec.yaml').readAsStringSync(),
        contains('- assets/sfx/'),
      );
    });

    test('only the two ringing sounds loop', () {
      expect(Sfx.values.where((s) => s.loop).toSet(), {Sfx.ring, Sfx.ringback});
    });
  });
}
