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
/// Declared with the `microphone` and `camera` service types, which Android 14
/// requires to match the permissions actually being used. Notably NOT
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

  /// Starts (or re-labels) the notification for [channelName].
  static Future<void> start(String channelName) async {
    if (!_isAndroid) return;
    try {
      _ensureInit();
      final running = await FlutterForegroundTask.isRunningService;
      if (running) {
        await FlutterForegroundTask.updateService(
          notificationTitle: 'In voice channel',
          notificationText: channelName,
        );
        return;
      }
      await FlutterForegroundTask.startService(
        serviceTypes: [
          ForegroundServiceTypes.microphone,
          ForegroundServiceTypes.camera,
        ],
        notificationTitle: 'In voice channel',
        notificationText: channelName,
      );
    } catch (e) {
      // Voice still works while the app is in front; only backgrounding is
      // affected. Not worth failing a join over.
      debugPrint('[voice] foreground service did not start: $e');
    }
  }

  static Future<void> stop() async {
    if (!_isAndroid) return;
    try {
      if (await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.stopService();
      }
    } catch (e) {
      debugPrint('[voice] foreground service did not stop: $e');
    }
  }

  /// The plugin is Android/iOS only, and this app ships Android — but it is
  /// also run on Flutter web as a test surface, where these calls would throw.
  static bool get _isAndroid =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
}
