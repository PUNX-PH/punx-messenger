import 'dart:async';

import 'package:punx_messenger/models/voice_clip.dart';
import 'package:punx_messenger/services/voice_playback.dart';

/// A stand-in player: records what it was asked, and lets the test say what the
/// phone's player would report.
class FakeBackend implements VoicePlayerBackend {
  final position = StreamController<Duration>.broadcast(sync: true);
  final duration = StreamController<Duration>.broadcast(sync: true);
  final playing = StreamController<bool>.broadcast(sync: true);
  final completed = StreamController<void>.broadcast(sync: true);
  final log = <String>[];
  Object? loadError;
  Object? playError;
  Object? seekError;
  bool disposed = false;

  @override
  Stream<Duration> get onPosition => position.stream;
  @override
  Stream<Duration> get onDuration => duration.stream;
  @override
  Stream<bool> get onPlaying => playing.stream;
  @override
  Stream<void> get onCompleted => completed.stream;

  @override
  Future<void> load(VoiceClip clip) async {
    log.add('load ${clip.mime}');
    if (loadError != null) throw loadError!;
  }

  @override
  Future<void> play() async {
    log.add('play');
    if (playError != null) throw playError!;
    playing.add(true);
  }

  @override
  Future<void> pause() async {
    log.add('pause');
    playing.add(false);
  }

  @override
  Future<void> seek(Duration to) async {
    log.add('seek ${to.inMilliseconds}');
    if (seekError != null) throw seekError!;
  }

  @override
  Future<void> dispose() async {
    disposed = true;
    log.add('dispose');
  }
}
