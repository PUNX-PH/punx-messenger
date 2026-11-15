import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

import '../models/voice_clip.dart';

/// Whatever actually makes the noise for a voice message. A seam, so the rules
/// in [VoiceClipController] are tested without a phone and the audio package can
/// be swapped (the same arrangement as the sound effects, sfx_service.dart).
abstract class VoicePlayerBackend {
  Stream<Duration> get onPosition;
  Stream<Duration> get onDuration;

  /// True while sound is coming out; false when paused, stopped or finished.
  Stream<bool> get onPlaying;

  /// Fires when the recording plays to its end.
  Stream<void> get onCompleted;

  /// Hands over the recording. Throws if this phone cannot read it.
  Future<void> load(VoiceClip clip);
  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration to);
  Future<void> dispose();
}

typedef VoicePlayerFactory = VoicePlayerBackend Function();

/// Plays through `audioplayers`, one player per message that has been played.
///
/// No audio context is set here, on purpose: on Android the package applies a
/// context to the whole PHONE (see [AudioplayersBackend] in sfx_service.dart, which
/// configures its players once at launch for that reason), so setting one when a
/// person taps play could reset the audio mode under a call. The player's own
/// defaults are used, and the screen refuses to play at all while a call or a voice
/// channel is live (see [VoiceClipController.play]'s caller).
class AudioplayersVoiceBackend implements VoicePlayerBackend {
  AudioplayersVoiceBackend() : _player = AudioPlayer() {
    _player.setReleaseMode(ReleaseMode.stop);
  }

  final AudioPlayer _player;

  @override
  Stream<Duration> get onPosition => _player.onPositionChanged;

  @override
  Stream<Duration> get onDuration => _player.onDurationChanged;

  @override
  Stream<bool> get onPlaying =>
      _player.onPlayerStateChanged.map((s) => s == PlayerState.playing);

  @override
  Stream<void> get onCompleted => _player.onPlayerComplete;

  @override
  Future<void> load(VoiceClip clip) =>
      _player.setSource(BytesSource(clip.bytes, mimeType: clip.mime));

  @override
  Future<void> play() => _player.resume();

  @override
  Future<void> pause() => _player.pause();

  @override
  Future<void> seek(Duration to) => _player.seek(to);

  @override
  Future<void> dispose() => _player.dispose();
}

/// One voice message's playback: play/pause, how far along, move to a point.
///
/// Only one message plays at a time (starting one stops the one before). Any
/// failure to play ends in [failed], shown as "Can't play", never as a crash: a
/// recording from another device can be in a format this phone does not read.
class VoiceClipController extends ChangeNotifier {
  VoiceClipController(this.clip, this._factory, {required this.isIPhone})
    : _total = Duration(milliseconds: clip.durationMs);

  final VoiceClip clip;
  final VoicePlayerFactory _factory;
  final bool isIPhone;

  /// The one that is playing now, so that starting another can stop it.
  static VoiceClipController? _current;

  @visibleForTesting
  static VoiceClipController? get current => _current;

  @visibleForTesting
  static void forgetCurrent() => _current = null;

  VoicePlayerBackend? _backend;
  final List<StreamSubscription<Object?>> _subs = [];
  bool _playing = false;
  bool _failed = false;
  bool _disposed = false;
  Duration _position = Duration.zero;
  Duration _total;

  bool get playing => _playing;

  /// Cannot be played on this phone (not read, or an iPhone offered WebM/Ogg).
  bool get failed => _failed || (isIPhone && !clip.playsOnIPhone);

  Duration get position => _position;

  /// The length: the file's own once known, otherwise the one stored with the
  /// message (some recorders write a file whose length cannot be known until it
  /// has played).
  Duration get total => _total;

  void _set(void Function() change) {
    if (_disposed) return;
    change();
    notifyListeners();
  }

  Future<void> toggle() async {
    if (failed) return;
    if (_playing) {
      await _backend?.pause();
      return;
    }
    if (_current != null && _current != this) {
      final other = _current!;
      _current = null;
      await other.stop();
    }
    _current = this;
    try {
      if (_backend == null) await _open();
      await _backend!.play();
    } catch (_) {
      if (_current == this) _current = null;
      _set(() {
        _failed = true;
        _playing = false;
      });
      await _release();
    }
  }

  Future<void> _open() async {
    final b = _factory();
    _backend = b;
    _subs
      ..add(
        b.onPosition.listen((p) {
          _set(() => _position = p);
        }),
      )
      ..add(
        b.onDuration.listen((d) {
          if (d > Duration.zero) _set(() => _total = d);
        }),
      )
      ..add(
        b.onPlaying.listen((on) {
          _set(() => _playing = on);
          if (!on && _current == this) _current = null;
        }),
      )
      ..add(
        b.onCompleted.listen((_) {
          _set(() {
            _playing = false;
            _position = Duration.zero;
          });
          if (_current == this) _current = null;
        }),
      );
    await b.load(clip);
  }

  /// Moves to [to] (clamped to the recording).
  Future<void> seek(Duration to) async {
    if (failed) return;
    final max = _total > Duration.zero ? _total : to;
    final target = to < Duration.zero ? Duration.zero : (to > max ? max : to);
    _set(() => _position = target);
    try {
      if (_backend == null) await _open();
      await _backend!.seek(target);
    } catch (_) {
      _set(() => _failed = true);
      await _release();
    }
  }

  /// Stops and goes back to the start (another message took over).
  Future<void> stop() async {
    try {
      await _backend?.pause();
      await _backend?.seek(Duration.zero);
    } catch (_) {
      // Already gone; nothing to stop.
    }
    _set(() {
      _playing = false;
      _position = Duration.zero;
    });
  }

  Future<void> _release() async {
    // Taken off the list before anything is awaited: a second release (the screen
    // going away while a failed one is being let go) must not walk the same list.
    final subs = List.of(_subs);
    _subs.clear();
    for (final s in subs) {
      await s.cancel();
    }
    final b = _backend;
    _backend = null;
    try {
      await b?.dispose();
    } catch (_) {
      // Nothing left to release.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    if (_current == this) _current = null;
    unawaited(_release());
    super.dispose();
  }
}
