import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../models/call.dart';
import '../services/calls_repository.dart';
import '../services/webrtc_service.dart';
import '../utils/constants.dart';
import 'auth_providers.dart';

final callsRepositoryProvider = Provider<CallsRepository>(
  (ref) => CallsRepository(),
);
final webrtcServiceProvider = Provider<WebrtcService>(
  (ref) => WebrtcService(),
);

enum CallStatus { idle, outgoing, incoming, connected }

class CallUiState {
  final Call? call;
  final CallStatus status;
  final MediaStream? localStream;
  final MediaStream? remoteStream;
  final bool muted;
  final bool cameraOff;
  final String? connError;

  const CallUiState({
    this.call,
    this.status = CallStatus.idle,
    this.localStream,
    this.remoteStream,
    this.muted = false,
    this.cameraOff = false,
    this.connError,
  });
}

Map<String, dynamic> _candidateToMap(RTCIceCandidate c) => {
  'candidate': c.candidate,
  'sdpMid': c.sdpMid,
  'sdpMLineIndex': c.sdpMLineIndex,
};

RTCIceCandidate _candidateFromMap(Map<String, dynamic> m) => RTCIceCandidate(
  m['candidate'] as String?,
  m['sdpMid'] as String?,
  m['sdpMLineIndex'] as int?,
);

/// Glues services/calls_repository.dart (Firestore signaling) to
/// services/webrtc_service.dart (RTCPeerConnection) behind one controller,
/// shared app-wide via [callControllerProvider] — same shape as
/// NotificationListenerService: a start(uid)/stop() pair driven by a small
/// daemon widget ([CallDaemon]) mounted once in AppShell's Stack, so there's
/// only ever one live signaling/PC session per client. See firestore.rules
/// `match /calls/{callId}` for the server-enforced state machine this
/// reacts to.
class CallController extends StateNotifier<CallUiState> {
  CallController(this._ref) : super(const CallUiState());
  final Ref _ref;

  CallsRepository get _repo => _ref.read(callsRepositoryProvider);
  WebrtcService get _webrtc => _ref.read(webrtcServiceProvider);

  String? _uid;
  List<Call> _activeCalls = const [];

  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  MediaStream? _remoteStream;
  String? _callId;
  String? _role; // 'caller' | 'callee'
  bool _muted = false;
  bool _cameraOff = false;
  String? _connError;

  StreamSubscription<List<Call>>? _activeCallsSub;
  StreamSubscription<Call?>? _callSub;
  StreamSubscription<CallCandidate>? _iceSub;
  Timer? _noAnswerTimer;
  final Set<String> _appliedCandidateIds = {};
  final List<RTCIceCandidate> _pendingRemoteCandidates = [];

  Future<void> start(String uid) async {
    if (_uid == uid) return;
    await stop();
    _uid = uid;
    unawaited(_repo.sweepStaleOutboundCalls(uid));
    // Without onError, a broken listener (e.g. a missing Firestore composite
    // index) fails *silently* — calls could be created but this client would
    // never learn about them. Surface it instead.
    _activeCallsSub = _repo
        .listenMyActiveCall(uid)
        .listen(
          _handleActiveCalls,
          onError: (Object err) {
            debugPrint('[calls] listenMyActiveCall failed: $err');
            _connError = err.toString().contains('failed-precondition')
                ? 'Calling isn’t set up yet — a required Firestore index is missing. Check the debug console for a link to create it.'
                : 'Calling is unavailable right now: $err';
            _publish();
          },
        );
  }

  Future<void> stop() async {
    await _activeCallsSub?.cancel();
    _activeCallsSub = null;
    _uid = null;
    _activeCalls = const [];
    await _teardown();
  }

  void _handleActiveCalls(List<Call> calls) {
    _activeCalls = calls;
    final uid = _uid;
    final call = calls.isNotEmpty ? calls.first : null;

    // Glare: I authored a call doc that lost the tie-break (lexicographically
    // smallest id wins) — cancel it myself; each side resolves independently,
    // see firestore.rules comments on match /calls/{callId}.
    if (uid != null && calls.length > 1) {
      for (final loser in calls.skip(1)) {
        if (loser.callerUid != uid) continue;
        unawaited(_repo.cancelCall(loser.id, uid));
        if (_callId == loser.id) unawaited(_teardown());
      }
    }

    // Busy: a fresh incoming ring arrives while I'm already accepted
    // elsewhere — auto-decline it (no pc was ever created for it).
    if (uid != null && call != null) {
      final alreadyOnACall = calls.any(
        (c) => c.state == 'accepted' && c.id != call.id,
      );
      if (alreadyOnACall && call.state == 'ringing' && call.calleeUid == uid) {
        unawaited(_repo.declineCall(call.id, uid));
      }
    }

    // Orphan cleanup: this call doc is still ringing/accepted in Firestore,
    // but nothing in *this* app launch created its peer connection (e.g. the
    // app was killed/restarted mid-call — the OS drops the local camera/mic
    // + RTCPeerConnection, but never told Firestore the call ended). v1 has
    // no reconnect/renegotiation flow, so there's no way to resume it — end
    // it instead of leaving a dead "connected" screen or an unusable stale
    // ring. A genuinely fresh incoming ring is exempt — that's the normal
    // "someone's calling me" case accept() will claim.
    if (uid != null && call != null && _callId != call.id) {
      final isFreshIncomingRing =
          call.state == 'ringing' && call.calleeUid == uid;
      if (!isFreshIncomingRing) {
        if (call.state == 'accepted') {
          unawaited(_repo.markFailed(call.id, uid));
        } else if (call.state == 'ringing' && call.callerUid == uid) {
          unawaited(_repo.cancelCall(call.id, uid));
        }
      }
    }

    _publish();
  }

  void _publish() {
    final uid = _uid;
    final call = _activeCalls.isNotEmpty ? _activeCalls.first : null;
    // A call this app launch isn't actively driving (see the orphan-cleanup
    // above) reports as idle immediately, rather than flashing a dead
    // connected/outgoing UI while the cleanup write is still in flight.
    final isMine = call != null && _callId == call.id;
    final isFreshIncomingRing =
        call != null && call.state == 'ringing' && call.calleeUid == uid;
    final status = call == null || (!isMine && !isFreshIncomingRing)
        ? CallStatus.idle
        : call.state == 'accepted'
        ? CallStatus.connected
        : call.callerUid == uid
        ? CallStatus.outgoing
        : CallStatus.incoming;
    state = CallUiState(
      call: call,
      status: status,
      localStream: _localStream,
      remoteStream: _remoteStream,
      muted: _muted,
      cameraOff: _cameraOff,
      connError: _connError,
    );
  }

  Future<void> _teardown() async {
    _noAnswerTimer?.cancel();
    _noAnswerTimer = null;
    await _callSub?.cancel();
    _callSub = null;
    await _iceSub?.cancel();
    _iceSub = null;
    await _pc?.close();
    _pc = null;
    await _webrtc.stopStream(_localStream);
    _localStream = null;
    _remoteStream = null;
    _callId = null;
    _role = null;
    _muted = false;
    _cameraOff = false;
    _appliedCandidateIds.clear();
    _pendingRemoteCandidates.clear();
    _publish();
  }

  void _flushPendingCandidates(RTCPeerConnection pc) {
    final pending = List<RTCIceCandidate>.from(_pendingRemoteCandidates);
    _pendingRemoteCandidates.clear();
    for (final c in pending) {
      unawaited(pc.addCandidate(c));
    }
  }

  // Listens to the call doc (state transitions) + candidates subcollection
  // for whichever call my current pc session belongs to.
  void _attachSignalingListeners(String callId) {
    _callSub = _repo.listenCall(callId).listen((call) async {
      if (call == null) return;
      final pc = _pc;
      if (pc == null) return;

      if (call.state == 'accepted' &&
          _role == 'caller' &&
          await pc.getRemoteDescription() == null) {
        _noAnswerTimer?.cancel();
        try {
          final answer = call.answer!;
          await pc.setRemoteDescription(
            RTCSessionDescription(
              answer['sdp'] as String?,
              answer['type'] as String?,
            ),
          );
          _flushPendingCandidates(pc);
        } catch (e) {
          _connError = e.toString();
          unawaited(_repo.markFailed(callId, _uid!));
        }
      }

      if (Call.terminalStates.contains(call.state)) {
        unawaited(_repo.cleanupCallCandidates(callId));
        unawaited(_teardown());
      }
    }, onError: (Object err) {
      _connError = 'Lost track of this call: $err';
      unawaited(_teardown());
    });

    _iceSub = _repo.listenIceCandidates(callId).listen((candDoc) async {
      if (candDoc.from == _uid) return;
      if (_appliedCandidateIds.contains(candDoc.id)) return;
      _appliedCandidateIds.add(candDoc.id);
      final pc = _pc;
      final candidate = _candidateFromMap(candDoc.candidate);
      if (pc != null && await pc.getRemoteDescription() != null) {
        unawaited(pc.addCandidate(candidate));
      } else {
        _pendingRemoteCandidates.add(candidate);
      }
    }, onError: (Object err) => _connError = 'Connection signaling failed: $err');
  }

  // _callId must already be set before this runs (both startCall and
  // accept() set it before creating the peer connection) so these closures
  // never race a not-yet-known call id.
  Future<RTCPeerConnection> _setupPeerConnection() async {
    final pc = await _webrtc.createConnection();
    _pc = pc;

    pc.onTrack = (event) {
      if (event.streams.isEmpty) return;
      _remoteStream = event.streams.first;
      _publish();
    };
    pc.onIceCandidate = (candidate) {
      final callId = _callId;
      if (callId == null) return;
      unawaited(
        _repo.sendIceCandidate(callId, _uid!, _candidateToMap(candidate)),
      );
    };
    pc.onIceConnectionState = (iceState) {
      final callId = _callId;
      if (callId == null) return;
      if (iceState == RTCIceConnectionState.RTCIceConnectionStateFailed) {
        unawaited(_repo.markFailed(callId, _uid!));
      }
    };
    return pc;
  }

  Future<void> startCall(String otherUid, {String callType = 'video'}) async {
    final uid = _uid;
    if (uid == null || _activeCalls.isNotEmpty) return; // v1: one call at a time
    _connError = null;
    final callId = _repo.newCallId();
    _callId = callId;
    _role = 'caller';
    try {
      final stream = await _webrtc.getLocalStream(video: callType == 'video');
      _localStream = stream;
      _publish();
      final pc = await _setupPeerConnection();
      for (final track in stream.getTracks()) {
        await pc.addTrack(track, stream);
      }

      final offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await _repo.createCall(
        callId: callId,
        callerUid: uid,
        calleeUid: otherUid,
        offer: {'sdp': offer.sdp, 'type': offer.type},
        type: callType,
      );

      _attachSignalingListeners(callId);
      _noAnswerTimer = Timer(
        const Duration(milliseconds: AppTiming.callNoAnswerTimeoutMs),
        () => unawaited(_repo.markMissed(callId, uid)),
      );
    } catch (e) {
      _connError = e.toString();
      await _teardown();
    }
  }

  Future<void> accept() async {
    final call = state.call;
    final uid = _uid;
    if (call == null ||
        uid == null ||
        call.state != 'ringing' ||
        call.calleeUid != uid) {
      return;
    }
    _connError = null;
    _callId = call.id;
    _role = 'callee';
    try {
      final stream = await _webrtc.getLocalStream(video: call.type == 'video');
      _localStream = stream;
      _publish();
      final pc = await _setupPeerConnection();
      for (final track in stream.getTracks()) {
        await pc.addTrack(track, stream);
      }

      final offer = call.offer!;
      await pc.setRemoteDescription(
        RTCSessionDescription(
          offer['sdp'] as String?,
          offer['type'] as String?,
        ),
      );
      _attachSignalingListeners(
        call.id,
      ); // remoteDescription already set — candidates apply immediately

      final answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await _repo.acceptCall(call.id, {
        'sdp': answer.sdp,
        'type': answer.type,
      });
    } catch (e) {
      _connError = e.toString();
      unawaited(_repo.markFailed(call.id, uid));
      await _teardown();
    }
  }

  Future<void> decline() async {
    final call = state.call;
    final uid = _uid;
    if (call == null || uid == null) return;
    try {
      await _repo.declineCall(call.id, uid);
    } catch (_) {}
    await _teardown();
  }

  Future<void> cancel() async {
    final call = state.call;
    final uid = _uid;
    if (call == null || uid == null) return;
    try {
      await _repo.cancelCall(call.id, uid);
    } catch (_) {}
    await _teardown();
  }

  Future<void> hangup() async {
    final callId = _callId;
    final uid = _uid;
    if (callId == null || uid == null) return;
    try {
      await _repo.endCall(callId, uid);
    } catch (_) {}
    await _teardown();
  }

  /// Single "end the call, whatever phase it's in" action for a unified button.
  Future<void> endActiveCall() async {
    final call = state.call;
    final uid = _uid;
    if (call == null || uid == null) return;
    if (call.state == 'ringing') {
      await (call.callerUid == uid ? cancel() : decline());
    } else if (call.state == 'accepted') {
      await hangup();
    }
  }

  void toggleMute() {
    final track = _localStream?.getAudioTracks().firstOrNull;
    if (track == null) return;
    track.enabled = !track.enabled;
    _muted = !track.enabled;
    _publish();
  }

  void toggleCamera() {
    final track = _localStream?.getVideoTracks().firstOrNull;
    if (track == null) return;
    track.enabled = !track.enabled;
    _cameraOff = !track.enabled;
    _publish();
  }

  @override
  void dispose() {
    unawaited(stop());
    super.dispose();
  }
}

final callControllerProvider =
    StateNotifierProvider<CallController, CallUiState>((ref) {
      return CallController(ref);
    });

/// Mount once inside the authenticated shell (alongside PresenceHeartbeat /
/// NotificationDaemon) — starts/stops the call engine as the signed-in user
/// changes. No UI of its own; see widgets/calls/call_overlay.dart for the
/// actual incoming/active-call UI, driven by [callControllerProvider].
class CallDaemon extends ConsumerStatefulWidget {
  const CallDaemon({super.key});

  @override
  ConsumerState<CallDaemon> createState() => _CallDaemonState();
}

class _CallDaemonState extends ConsumerState<CallDaemon> {
  String? _startedFor;

  @override
  Widget build(BuildContext context) {
    final uid = ref.watch(profileProvider).valueOrNull?.id;
    if (uid != null && uid != _startedFor) {
      _startedFor = uid;
      unawaited(ref.read(callControllerProvider.notifier).start(uid));
    } else if (uid == null && _startedFor != null) {
      _startedFor = null;
      unawaited(ref.read(callControllerProvider.notifier).stop());
    }
    return const SizedBox.shrink();
  }
}
