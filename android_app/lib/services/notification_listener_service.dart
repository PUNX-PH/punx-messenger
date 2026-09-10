import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../providers/auth_providers.dart';
import '../providers/users_providers.dart';
import '../router/app_router.dart';

/// Foreground/backgrounded-but-alive notifications — port of
/// notifications.jsx. There is no FCM/Cloud Function here, same as the web
/// app has no service worker: this only fires while the Flutter process is
/// alive (foreground or backgrounded), driven by the same two live listener
/// shapes (DM last-message, and a mentions collectionGroup query). An app
/// fully killed/swiped away will not notify — identical boundary to the web
/// app's "tab must be open" constraint.
class NotificationListenerService {
  NotificationListenerService(this._ref);
  final Ref _ref;

  final _plugin = FlutterLocalNotificationsPlugin();
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _dmSub;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _mentionSub;
  DateTime? _baseline;
  final Map<String, String> _lastFired = {};
  String? _uid;
  bool _pluginInitialized = false;

  bool get _shouldNotify {
    final state = WidgetsBinding.instance.lifecycleState;
    return state != null && state != AppLifecycleState.resumed;
  }

  Future<void> start(String uid) async {
    if (_uid == uid) return;
    await stop();
    _uid = uid;
    _baseline = DateTime.now();
    _lastFired.clear();

    await _ensurePluginInitialized();
    try {
      await Permission.notification.request();
    } catch (_) {
      // non-fatal — the app just won't be able to show notifications
    }

    _dmSub = FirebaseFirestore.instance
        .collection('dms')
        .where('members', arrayContains: uid)
        .snapshots()
        .listen((snap) {
          for (final doc in snap.docs) {
            _handleDmDoc(uid, doc);
          }
        });

    _mentionSub = FirebaseFirestore.instance
        .collectionGroup('messages')
        .where('mentionedUids', arrayContains: uid)
        .orderBy('createdAt', descending: true)
        .limit(20)
        .snapshots()
        .listen(
          (snap) {
            for (final change in snap.docChanges) {
              if (change.type == DocumentChangeType.removed) continue;
              _handleMentionDoc(uid, change.doc);
            }
          },
          onError: (_) {},
        ); // e.g. missing composite index — matches web's soft failure
  }

  void _handleDmDoc(String uid, DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    if (data == null) return;
    final ts = (data['lastMessageAt'] as Timestamp?)?.toDate();
    final authorUid = data['lastMessageAuthorUid'] as String?;
    final baseline = _baseline;
    if (ts == null ||
        authorUid == null ||
        authorUid == uid ||
        baseline == null ||
        !ts.isAfter(baseline)) {
      return;
    }
    final members = List<String>.from(data['members'] as List? ?? const []);
    final otherUid = members.firstWhere((m) => m != uid, orElse: () => '');
    if (otherUid.isEmpty) return;
    // Resolves the author's live display name from the workspace directory
    // (not the DM doc's `memberInfo` snapshot, which freezes at DM-creation
    // time) — matches notifications.jsx's `byId[dm.lastMessageAuthorUid]`.
    final authorName =
        _ref.read(usersByIdProvider)[authorUid]?.name ?? 'New message';
    final body = (data['lastMessageText'] as String?) ?? '';
    _fire(
      key: 'dm:${doc.id}',
      title: authorName,
      body: body,
      path: '/dms/$otherUid',
    );
  }

  void _handleMentionDoc(
    String uid,
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data();
    if (data == null) return;
    final author = data['author'] as Map<String, dynamic>? ?? const {};
    if (author['uid'] == uid) return;
    final ts = (data['createdAt'] as Timestamp?)?.toDate();
    final baseline = _baseline;
    if (ts == null || baseline == null || !ts.isAfter(baseline)) return;

    final segments = doc.reference.path.split('/');
    // parts = ['groups', gid, 'channels', cid, 'messages', mid] — DMs are
    // covered by _handleDmDoc above.
    if (segments.isEmpty || segments[0] != 'groups') return;
    final groupId = segments[1];
    final channelId = segments[3];

    final authorName = author['name'] as String? ?? 'Someone';
    final body =
        (data['text'] as String?) ??
        (data['imageURL'] != null ? '[image]' : '');
    _fire(
      key: 'mention:${doc.id}',
      title: '$authorName mentioned you',
      body: body,
      path: '/g/$groupId/c/$channelId',
    );
  }

  void _fire({
    required String key,
    required String title,
    required String body,
    required String path,
  }) {
    if (!_shouldNotify) return;
    final dedupeValue = '$body|$path';
    if (_lastFired[key] == dedupeValue) return;
    _lastFired[key] = dedupeValue;

    unawaited(
      _plugin.show(
        key.hashCode,
        title,
        _stripTokens(body),
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'messages',
            'Messages',
            channelDescription: 'New DMs and @mentions',
            importance: Importance.high,
            priority: Priority.high,
          ),
        ),
        payload: path,
      ),
    );
  }

  static const _maxBodyLen = 140;

  String _stripTokens(String text) {
    var out = text.replaceAll(RegExp(r'<@[A-Za-z0-9_-]+>'), '@someone');
    out = out.replaceAll(RegExp(r'```[\s\S]*?```'), '[code]');
    out = out.replaceAllMapped(RegExp(r'`([^`]+)`'), (m) => m.group(1) ?? '');
    out = out.replaceAll(RegExp(r'[*_~]'), '');
    return out.length > _maxBodyLen ? out.substring(0, _maxBodyLen) : out;
  }

  Future<void> _ensurePluginInitialized() async {
    if (_pluginInitialized) return;
    _pluginInitialized = true;

    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    // iOS was never initialised, so nothing could appear there at all. The
    // permission prompts are requested by the plugin itself on Darwin rather
    // than by permission_handler, which is the supported path — leaving them
    // false would initialise a plugin that is then never allowed to post.
    const darwinInit = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );
    await _plugin.initialize(
      const InitializationSettings(android: androidInit, iOS: darwinInit),
      onDidReceiveNotificationResponse: (response) {
        final path = response.payload;
        if (path != null) _ref.read(routerProvider).go(path);
      },
    );

    const channel = AndroidNotificationChannel(
      'messages',
      'Messages',
      description: 'New DMs and @mentions',
      importance: Importance.high,
    );
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(channel);
  }

  Future<void> stop() async {
    await _dmSub?.cancel();
    await _mentionSub?.cancel();
    _dmSub = null;
    _mentionSub = null;
    _uid = null;
  }
}

final notificationListenerServiceProvider =
    Provider<NotificationListenerService>((ref) {
      final service = NotificationListenerService(ref);
      ref.onDispose(() {
        unawaited(service.stop());
      });
      return service;
    });

/// Mount once inside the authenticated shell — starts/stops the listener
/// service as the signed-in user changes. No UI.
class NotificationDaemon extends ConsumerStatefulWidget {
  const NotificationDaemon({super.key});

  @override
  ConsumerState<NotificationDaemon> createState() => _NotificationDaemonState();
}

class _NotificationDaemonState extends ConsumerState<NotificationDaemon> {
  String? _startedFor;

  @override
  Widget build(BuildContext context) {
    // flutter_local_notifications has no web implementation.
    if (kIsWeb) return const SizedBox.shrink();

    final uid = ref.watch(profileProvider).valueOrNull?.id;
    if (uid != null && uid != _startedFor) {
      _startedFor = uid;
      unawaited(ref.read(notificationListenerServiceProvider).start(uid));
    } else if (uid == null && _startedFor != null) {
      _startedFor = null;
      unawaited(ref.read(notificationListenerServiceProvider).stop());
    }
    return const SizedBox.shrink();
  }
}
