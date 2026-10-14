import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// Keeps voice alive when the app is not in front.
///
/// Android stops a backgrounded process from holding the microphone, and on a
/// phone backgrounding is constant — you check something mid-conversation and
/// your audio dies. A foreground service is the only sanctioned way around
/// that, and its price is the persistent notification the platform requires: it
/// exists so the user can always see that something is holding their mic.
///
/// Declared with the `microphone` type, plus `camera` only while a camera is
/// open — Android 14 requires the type to match what is actually in use, and
/// refuses to start a camera-typed service without the camera permission. Notably NOT
/// `mediaProjection` — Android watches screen shares but never sends one, so
/// claiming that type would be asking for a permission this app has no use for.
///
/// Everything here is deliberately best-effort. Losing the service costs
/// background audio; throwing out of it would cost the whole call, and that is
/// the worse failure. Nothing on this path may take a voice session down.
abstract final class VoiceForegroundService {
  static bool _initialised = false;

  static void _ensureInit() {
    if (_initialised) return;
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'punx_voice',
        channelName: 'Voice channel',
        channelDescription: 'Shown while you are connected to a voice channel.',
        // LOW: this is a status indicator, not something to interrupt anyone.
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
      ),
      iosNotificationOptions: const IOSNotificationOptions(),
      foregroundTaskOptions: ForegroundTaskOptions(
        // No periodic callback: the service exists purely to hold the process
        // alive so WebRTC keeps running. Waking Dart on a timer would burn
        // battery for nothing.
        eventAction: ForegroundTaskEventAction.nothing(),
        allowWakeLock: true,
        autoRunOnBoot: false,
      ),
    );
    _initialised = true;
  }

  /// What the running service currently claims. Android 14 refuses to start a
  /// service whose declared type needs a permission the app does not hold yet,
  /// so the camera type is only claimed while a camera is actually open — and
  /// the type cannot be changed on a running service, only by restarting it.
  static bool _withCamera = false;

  /// Starts (or re-labels) the notification for [channelName].
  ///
  /// Microphone only unless [camera] is true. It used to claim `camera` every
  /// time, which on Android 14+ throws a SecurityException for anyone who has not
  /// granted the camera permission — i.e. most voice users — so the service
  /// never started and backgrounding silently killed their audio.
  static Future<void> start(String channelName, {bool camera = false}) async {
    if (!_isAndroid) return;
    try {
      _ensureInit();
      final running = await FlutterForegroundTask.isRunningService;
      if (running && camera == _withCamera) {
        _report(
          'update',
          await FlutterForegroundTask.updateService(
            notificationTitle: 'In voice channel',
            notificationText: channelName,
          ),
        );
        return;
      }
      if (running) {
        // The type has to change, which only a restart can do.
        _report('stop', await FlutterForegroundTask.stopService());
      }
      // startService does not throw: it RETURNS a failure. Ignoring the result
      // is how a service that never started looked exactly like one that had.
      final result = await FlutterForegroundTask.startService(
        serviceTypes: [
          ForegroundServiceTypes.microphone,
          if (camera) ForegroundServiceTypes.camera,
        ],
        notificationTitle: 'In voice channel',
        notificationText: channelName,
      );
      _report('start', result);
      _withCamera = result is ServiceRequestSuccess && camera;
    } catch (e) {
      // Voice still works while the app is in front; only backgrounding is
      // affected. Not worth failing a join over.
      debugPrint('[voice] foreground service did not start: $e');
    }
  }

  /// Re-types the running service when the camera goes on or off. A no-op when
  /// nothing is running or the type already matches.
  static Future<void> setCamera(bool on, String channelName) async {
    if (!_isAndroid || on == _withCamera) return;
    if (!await FlutterForegroundTask.isRunningService) return;
    await start(channelName, camera: on);
  }

  static Future<void> stop() async {
    if (!_isAndroid) return;
    try {
      if (await FlutterForegroundTask.isRunningService) {
        _report('stop', await FlutterForegroundTask.stopService());
      }
    } catch (e) {
      debugPrint('[voice] foreground service did not stop: $e');
    }
    _withCamera = false;
  }

  static void _report(String what, ServiceRequestResult result) {
    if (result is ServiceRequestFailure) {
      debugPrint('[voice] foreground service $what failed: ${result.error}');
    }
  }

  /// The plugin is Android/iOS only, and this app ships Android — but it is
  /// also run on Flutter web as a test surface, where these calls would throw.
  static bool get _isAndroid =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
}
