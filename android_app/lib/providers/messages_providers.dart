import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/message.dart';
import '../services/messages_repository.dart';
import '../utils/constants.dart';
import '../utils/firestore_paths.dart';
import '../utils/forward.dart';
import '../utils/forward_targets.dart';
import '../utils/saved.dart';
import '../utils/seen.dart';
import 'auth_providers.dart';
import 'dm_providers.dart';
import 'users_providers.dart';

final messagesRepositoryProvider = Provider<MessagesRepository>(
  (ref) => MessagesRepository(),
);

/// How many messages are currently subscribed for a given path.
///
/// Keyed by path so switching channels never starts you deep in another
/// conversation's history, and reset to one page whenever a channel is opened
/// fresh. Growing it resubscribes [messagesProvider] with a wider window.
final messageLimitProvider =
    StateProvider.family<int, String>((ref, path) => AppTiming.messagePageSize);

/// Live messages at a given collection path (channel/DM/notes), newest window
/// first, plus whether older messages exist behind it.
final messagesProvider = StreamProvider.family<MessagePage, String>((
  ref,
  path,
) {
  final limit = ref.watch(messageLimitProvider(path));
  return ref.watch(messagesRepositoryProvider).listenMessages(path, limit: limit);
});

/// Every reply to one message, live: the collection path and the message's id. This is a thread's
/// replies, read with their own query so it is not limited to the part of the conversation that is
/// loaded.
final repliesProvider =
    StreamProvider.family<List<ChatMessage>, ({String path, String rootId})>(
      (ref, key) => ref
          .watch(messagesRepositoryProvider)
          .listenReplies(key.path, key.rootId),
    );

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

/// The rendered "X is typing…" line, or null when nobody is.
///
/// This exists to stop a rebuild loop, and the type is the whole point.
/// [typingNamesProvider] rebuilds a fresh List every [AppTiming.typingTickMs]
/// tick, and Riverpod compares values with `==` — List uses IDENTITY equality,
/// so two empty lists are never equal and every tick notified its listeners.
/// The only listener was the entire chat surface, message list and composer
/// included, so the whole screen rebuilt every 2 seconds whether or not anyone
/// was typing. That is what "the channel is flickering" was.
///
/// A String does have value equality, so watching this instead means the chat
/// surface rebuilds only when the sentence actually changes. The list provider
/// still recomputes on the tick — that part is cheap and is what keeps
/// staleness honest — it just no longer drags the UI along with it.
final typingLabelProvider = Provider.family<String?, String>((
  ref,
  containerPath,
) {
  final names = ref.watch(typingNamesProvider(containerPath));
  if (names.isEmpty) return null;
  if (names.length == 1) return '${names[0]} is typing…';
  if (names.length == 2) return '${names[0]} and ${names[1]} are typing…';
  final extra = names.length - 2;
  return '${names[0]}, ${names[1]}, and $extra '
      '${extra == 1 ? 'other' : 'others'} are typing…';
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
  ///
  /// [replyTo] quotes that message (a reply written in its thread); without it the message quotes
  /// the one being replied to in the conversation, if any, and that is then cleared.
  Future<void> send({
    required String text,
    Uint8List? imageBytes,
    String? imageName,
    String? remoteImageUrl,
    Map<String, dynamic>? remoteImageMeta,
    ChatMessage? replyTo,
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
      replyTo: replyTo ?? state.replyingTo,
    );
    if (replyTo == null) setReplyingTo(null);
    setTyping(false);
  }

  /// Forwards [message] to [target] as a new message from the person, marked with who wrote it
  /// first (see utils/forward.dart). True when it went; false when it could not (nothing to
  /// forward, not signed in, or the write failed).
  Future<bool> forwardMessage(ChatMessage message, ForwardTarget target) async {
    final me = _ref.read(profileProvider).valueOrNull;
    final payload = forwardPayload(message, _ref.read(usersByIdProvider));
    if (me == null || payload == null) return false;
    try {
      // A person you have not messaged yet has no conversation to put it in.
      final other = target.user;
      if (target.kind == TargetKind.dm && other != null) {
        await _ref.read(dmRepositoryProvider).ensureDmConvo(me, other);
      }
      await _repo.sendMessage(
        target.path,
        text: payload.text,
        author: me,
        remoteImageUrl: payload.imageURL,
        remoteImageMeta: payload.imageMeta?.toMap(),
        voice: payload.voice,
        forwardedFrom: payload.forwardedFrom,
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Keeps a copy of [message] in My Notes. The result says whether it was saved, was already
  /// there, or could not be (nothing to save, or the write failed).
  Future<SaveResult> saveToNotes(ChatMessage message) async {
    final me = _ref.read(profileProvider).valueOrNull;
    final id = savedNoteId(message.id);
    final payload = savedPayload(message, _ref.read(usersByIdProvider), path);
    if (me == null || id == null || payload == null) return SaveResult.failed;
    try {
      return await _repo.saveMessageToNotes(me, id, payload);
    } catch (_) {
      return SaveResult.failed;
    }
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
  ///
  /// [newest] is the time of the newest message on screen and [visible] whether the app is in front:
  /// together with your own receipt and your sharing choice they decide whether this also records
  /// that you had the DM open (shouldRecordSeen), for the other person's "Seen".
  Future<void> markRead({Timestamp? newest, bool visible = true}) async {
    final me = _ref.read(profileProvider).valueOrNull;
    final uid = me?.id;
    if (uid == null || path.startsWith('users/')) return;
    final seen = shouldRecordSeen(
      containerPath: containerPath,
      newestCreatedAt: newest,
      seen: me!.seen[pathToReadKey(containerPath)],
      share: me.shareSeen,
      visible: visible,
    );
    await _repo.markRead(uid, containerPath, seen: seen);
  }
}

final chatControllerProvider =
    StateNotifierProvider.family<ChatController, ChatUiState, String>((
      ref,
      path,
    ) {
      return ChatController(ref, path);
    });
