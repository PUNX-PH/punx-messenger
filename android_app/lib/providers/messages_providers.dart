import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/message.dart';
import '../services/messages_repository.dart';
import '../utils/constants.dart';
import '../utils/firestore_paths.dart';
import 'auth_providers.dart';
import 'users_providers.dart';

final messagesRepositoryProvider = Provider<MessagesRepository>(
  (ref) => MessagesRepository(),
);

/// Live messages at a given collection path (channel/DM/notes).
final messagesProvider = StreamProvider.family<List<ChatMessage>, String>((
  ref,
  path,
) {
  return ref.watch(messagesRepositoryProvider).listenMessages(path);
});

/// Live container doc (channel or DM convo) — used for the `typing` map.
final containerProvider = StreamProvider.family<Map<String, dynamic>?, String>((
  ref,
  containerPath,
) {
  return ref.watch(messagesRepositoryProvider).listenContainer(containerPath);
});

/// Re-ticks every [AppTiming.typingTickMs] so stale typing entries age out
/// promptly even without a new Firestore snapshot — mirrors ChatSurface.jsx's
/// fast ticker.
final _typingTickProvider = StreamProvider<int>((ref) {
  return Stream.periodic(
    const Duration(milliseconds: AppTiming.typingTickMs),
    (i) => i,
  );
});

/// Display names currently typing in a container (excluding yourself, and
/// excluding entries older than [AppTiming.typingStaleMs]).
final typingNamesProvider = Provider.family<List<String>, String>((
  ref,
  containerPath,
) {
  ref.watch(_typingTickProvider);
  final container = ref.watch(containerProvider(containerPath)).valueOrNull;
  final myUid = ref.watch(authStateProvider).valueOrNull?.uid;
  final usersById = ref.watch(usersByIdProvider);

  final typing = container?['typing'] as Map<String, dynamic>? ?? const {};
  final now = DateTime.now().millisecondsSinceEpoch;

  final names = <String>[];
  typing.forEach((uid, ts) {
    if (uid == myUid) return;
    final tsMs = ts is Timestamp ? ts.millisecondsSinceEpoch : 0;
    if (now - tsMs >= AppTiming.typingStaleMs) return;
    final name = usersById[uid]?.name;
    if (name != null && name.isNotEmpty) names.add(name);
  });
  return names;
});

class ChatUiState {
  final ChatMessage? replyingTo;
  const ChatUiState({this.replyingTo});
}

/// Per-chat-surface UI state + actions, bridging widgets to
/// [MessagesRepository] — mirrors the handlers ChatSurface.jsx defines
/// around db.js's message functions.
class ChatController extends StateNotifier<ChatUiState> {
  ChatController(this._ref, this.path) : super(const ChatUiState());

  final Ref _ref;
  final String path;

  MessagesRepository get _repo => _ref.read(messagesRepositoryProvider);
  String get containerPath => containerPathFromMessagesPath(path);

  void setReplyingTo(ChatMessage? message) {
    state = ChatUiState(replyingTo: message);
  }

  /// `text` must already have mentions resolved to `<@uid>` tokens (the
  /// composer does this before calling send).
  Future<void> send({
    required String text,
    Uint8List? imageBytes,
    String? imageName,
    String? remoteImageUrl,
    Map<String, dynamic>? remoteImageMeta,
  }) async {
    final me = _ref.read(profileProvider).valueOrNull;
    if (me == null) return;
    await _repo.sendMessage(
      path,
      text: text,
      author: me,
      imageBytes: imageBytes,
      imageName: imageName,
      remoteImageUrl: remoteImageUrl,
      remoteImageMeta: remoteImageMeta,
      replyTo: state.replyingTo,
    );
    setReplyingTo(null);
    setTyping(false);
  }

  Future<void> togglePin(ChatMessage message) =>
      _repo.setMessagePinned('$path/${message.id}', !message.pinned);

  Future<void> edit(ChatMessage message, String text) =>
      _repo.editMessageText('$path/${message.id}', text);

  Future<void> delete(ChatMessage message) =>
      _repo.deleteMessage('$path/${message.id}');

  Future<void> react(ChatMessage message, String key) {
    final uid = _ref.read(profileProvider).valueOrNull?.id;
    if (uid == null) return Future.value();
    return _repo.toggleReaction('$path/${message.id}', key, uid);
  }

  void setTyping(bool isTyping) {
    final uid = _ref.read(profileProvider).valueOrNull?.id;
    if (uid == null) return;
    _repo.setTyping(containerPath, uid, isTyping);
  }

  /// Skips the personal notes path — nothing to track unread for there.
  Future<void> markRead() async {
    final uid = _ref.read(profileProvider).valueOrNull?.id;
    if (uid == null || path.startsWith('users/')) return;
    await _repo.markRead(uid, containerPath);
  }
}

final chatControllerProvider =
    StateNotifierProvider.family<ChatController, ChatUiState, String>((
      ref,
      path,
    ) {
      return ChatController(ref, path);
    });
