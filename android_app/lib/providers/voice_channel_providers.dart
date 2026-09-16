import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../models/voice_participant.dart';
import '../services/voice_channel_repository.dart';
import '../services/voice_foreground_service.dart';
import '../services/webrtc_service.dart';
import 'auth_providers.dart';
import 'calls_providers.dart' show webrtcServiceProvider;

/// Mesh WebRTC voice channels — the Android half of the system in
/// `src/lib/useVoiceChannel.jsx`. Every participant holds a direct peer
/// connection to every other; Firestore carries only signaling. Both clients
/// join the same rooms, so the behaviour here has to match that file, not
/// merely resemble it.
///
/// Deliberately separate from CallController (1:1 DM calls): that has a
/// ring/accept state machine and exactly one peer. Nothing there is reused
/// except [WebrtcService], the raw plumbing both need.

const _heartbeat = Duration(seconds: 15);

/// Speaking detection polls `getStats()` rather than analysing audio, because
/// there is no Web Audio on mobile. Slower than the web's 150ms AnalyserNode
/// loop on purpose: this walks every peer connection's stats, and doing that
/// six times a second on a phone is a real battery cost for a glowing ring.
const _speakingPoll = Duration(milliseconds: 300);
const _speakingHangover = Duration(milliseconds: 400);

/// `audioLevel` from getStats is 0..1 RMS, a different scale from the web's
/// 0..255 frequency-bin average, so this threshold is tuned independently and
/// is NOT the web's 12/255. Low enough to catch quiet talkers, high enough to
/// ignore room tone.
const _speakingThreshold = 0.02;

class VoiceChannelRef {
  const VoiceChannelRef(this.groupId, this.channelId, this.channelName);
  final String groupId;
  final String channelId;
  final String channelName;

  bool same(String g, String c) => groupId == g && channelId == c;
}

class VoiceUiState {
  const VoiceUiState({
    this.active,
    this.participants = const [],
    this.remoteStreams = const {},
    this.remoteVideoTracks = const {},
    this.speakingUids = const {},
    this.muted = false,
    this.deafened = false,
    this.cameraOn = false,
    this.speakerphone = false,
    this.localVideoStream,
    this.joining = false,
    this.connError,
  });

  final VoiceChannelRef? active;
  final List<VoiceParticipant> participants;

  /// Per-peer stream carrying whatever that peer is sending. Audio plays
  /// through the device automatically; the tile only renders the video.
  final Map<String, MediaStream> remoteStreams;

  /// The peer's video track, held separately so the UI can listen to its
  /// mute/unmute without digging through the stream. See the note on
  /// re-attaching in the voice room.
  final Map<String, MediaStreamTrack> remoteVideoTracks;

  final Set<String> speakingUids;
  final bool muted;
  final bool deafened;
  final bool cameraOn;

  /// Tracked here rather than read back from the OS: Android exposes no
  /// reliable getter for the current routing, so this is what we last asked
  /// for. Kept in state so the settings toggle does not forget its position
  /// each time the sheet is closed.
  final bool speakerphone;

  final MediaStream? localVideoStream;
  final bool joining;
  final String? connError;

  bool get connected => active != null;

  VoiceUiState copyWith({
    VoiceChannelRef? active,
    bool clearActive = false,
    List<VoiceParticipant>? participants,
    Map<String, MediaStream>? remoteStreams,
    Map<String, MediaStreamTrack>? remoteVideoTracks,
    Set<String>? speakingUids,
    bool? muted,
    bool? deafened,
    bool? cameraOn,
    bool? speakerphone,
    MediaStream? localVideoStream,
    bool clearLocalVideo = false,
    bool? joining,
    String? connError,
    bool clearError = false,
  }) {
    return VoiceUiState(
      active: clearActive ? null : (active ?? this.active),
      participants: participants ?? this.participants,
      remoteStreams: remoteStreams ?? this.remoteStreams,
      remoteVideoTracks: remoteVideoTracks ?? this.remoteVideoTracks,
      speakingUids: speakingUids ?? this.speakingUids,
      muted: muted ?? this.muted,
      deafened: deafened ?? this.deafened,
      cameraOn: cameraOn ?? this.cameraOn,
      speakerphone: speakerphone ?? this.speakerphone,
      localVideoStream:
          clearLocalVideo ? null : (localVideoStream ?? this.localVideoStream),
      joining: joining ?? this.joining,
      connError: clearError ? null : (connError ?? this.connError),
    );
  }
}

/// One mesh edge.
class _Peer {
  _Peer(this.pc);

  final RTCPeerConnection pc;

  /// Null on the answering side until [VoiceController._adoptVideoTransceiver]
  /// fills it in — every use is null-guarded so a peer whose offer carried no
  /// video m-line degrades to audio-only rather than throwing.
  RTCRtpSender? videoSender;

  StreamSubscription<dynamic>? candidatesSub;

  /// Candidates that arrived before the remote description was applied.
  /// addIceCandidate before then is an error.
  final List<RTCIceCandidate> pending = [];
  final Set<String> appliedCandidateIds = {};

  MediaStream? remote;
  MediaStreamTrack? videoTrack;
  bool hasRemoteDescription = false;

  /// Answerer side: the offer this connection answered. A leftover signalling
  /// doc gets deleted and re-offered by the other side (see
  /// VoiceChannelRepository.createVoiceOffer), so "have I answered this PEER"
  /// is the wrong question — the replacement offer must be answered too, or
  /// that pair stays silent for the whole session while every other pair works.
  String? answeredOfferSdp;

  /// Offerer side: the offer this connection published, and whether the answer
  /// belonging to it has been applied. Both are set before the awaits they
  /// guard: _onSignals is async and re-entrant (the listener redelivers on any
  /// change), so a flag set only after an await lets two runs through.
  String? offeredSdp;
  bool answerApplied = false;
}

/// Runs a native-only audio call, or skips it.
///
/// Every `Helper.*` used here — ensureAudioSession, setMicrophoneMute,
/// setVolume, setSpeakerphoneOn, switchCamera, clearAndroidCommunicationDevice
/// — goes through a platform channel to NativeAudioManagement. On Flutter web,
/// which is this app's test surface rather than a product, there is no
/// implementation and they throw MissingPluginException.
///
/// None of them is required to HOLD a call: they tune routing and playback,
/// while the connection itself is pure WebRTC. So each is skipped on web and,
/// on a device, logged rather than allowed to take a session down. An
/// unguarded ensureAudioSession() is what made joining voice fail on web with
/// "No implementation found for method initialize" before anything else ran.
///
/// Anything that must work on every platform — notably muting a track for
/// deafen — uses `track.enabled` instead, which is not a platform call.
Future<void> _nativeAudio(String what, Future<void> Function() op) async {
  if (kIsWeb) return;
  try {
    await op();
  } catch (e) {
    debugPrint('[voice] $what unavailable: $e');
  }
}

/// How long to wait before touching a freshly-arrived remote audio track
/// natively. Long enough for libwebrtc to finish dispatching the track event;
/// short enough that a deafened listener does not hear a burst first.
const _volumeSettleDelay = Duration(milliseconds: 300);

class VoiceController extends StateNotifier<VoiceUiState> {
  VoiceController(this._ref) : super(const VoiceUiState());
  final Ref _ref;

  VoiceChannelRepository get _repo => _ref.read(voiceChannelRepositoryProvider);
  WebrtcService get _webrtc => _ref.read(webrtcServiceProvider);

  String? get _myUid => _ref.read(profileProvider).valueOrNull?.id;

  final Map<String, _Peer> _peers = {};

  /// peerUid -> the offer SDP we have already answered for that pair.
  ///
  /// Deliberately OUTSIDE [_Peer]: closing a peer must not erase the fact that
  /// we answered, because voiceSignals' update rule permits exactly one answer
  /// per document. Answering a second time is refused, and treating that
  /// refusal as "the offer was superseded, drop the peer and retry" is a loop
  /// — one that rebuilt the peer connection on every redelivery, so the remote
  /// renderer never held a track long enough to paint and a share sat on its
  /// spinner forever.
  ///
  /// Cleared only when a pair genuinely ends, so a rejoin negotiates cleanly.
  final Map<String, String?> _answeredOffers = {};
  MediaStream? _localAudio;
  MediaStream? _cameraStream;
  StreamSubscription<RosterUpdate>? _rosterSub;
  StreamSubscription<List<VoiceSignal>>? _signalsSub;
  Timer? _heartbeatTimer;
  Timer? _speakingTimer;
  Timer? _videoStatsTimer; // DIAGNOSTIC, see _logVideoStats
  final Map<String, DateTime> _lastLoudAt = {};

  // ---------- join / leave ----------

  Future<void> join(String groupId, String channelId, String channelName) async {
    final myUid = _myUid;
    if (myUid == null || state.joining) return;
    if (state.active?.same(groupId, channelId) == true) return;
    if (state.active != null) await _teardown();

    state = state.copyWith(joining: true, clearError: true);
    try {
      // Audio session first: without it Android can route voice to the wrong
      // device or leave the stream at media (not communication) volume.
      await _nativeAudio('audio session', Helper.ensureAudioSession);
      // Throws if the user refuses the microphone, which is a refusal to
      // answer rather than a fault — say so plainly instead of surfacing a
      // platform exception.
      try {
        _localAudio = await _webrtc.getLocalStream(audio: true, video: false);
      } catch (e) {
        throw Exception(
          'Punx needs microphone access to join a voice channel. $e',
        );
      }

      // Before the roster write, so the process is already protected by the
      // time anyone can see us in the channel.
      await VoiceForegroundService.start(channelName);

      final ref = VoiceChannelRef(groupId, channelId, channelName);
      state = state.copyWith(active: ref);

      await _repo.joinRoster(groupId, channelId, myUid);

      _heartbeatTimer = Timer.periodic(_heartbeat, (_) {
        _repo.heartbeatRoster(groupId, channelId, myUid);
        _repo.pruneStaleParticipants(groupId, channelId, myUid);
      });
      _speakingTimer = Timer.periodic(_speakingPoll, (_) => _pollSpeaking());
      // DIAGNOSTIC: is remote video arriving and failing to decode, or not
      // arriving at all? Those need opposite fixes and the UI cannot tell them
      // apart — a blank tile looks identical either way.
      _videoStatsTimer =
          Timer.periodic(const Duration(seconds: 1), (_) => _logVideoStats());

      _signalsSub = _repo
          .listenMySignals(groupId, channelId, myUid)
          .listen(_onSignals, onError: (Object e) {
        state = state.copyWith(connError: 'Voice signaling failed: $e');
      });

      // Attached last on purpose: its first emission both discovers the people
      // already here and starts ongoing add/remove reactivity, in one path.
      _rosterSub = _repo
          .listenParticipants(groupId, channelId)
          .listen(_onRoster, onError: (Object e) {
        state = state.copyWith(
            connError: "Couldn't load who's in this voice channel: $e");
      });
    } catch (e) {
      // Logged as well as surfaced: this path tears the session down, and a
      // permission-denied from joinRoster is otherwise completely silent —
      // Firestore logs failed listeners but not rejected writes.
      debugPrint('[voice] join failed: $e');
      // Passed THROUGH the teardown rather than set before it: teardown resets
      // the state wholesale, so setting the error first would wipe the only
      // explanation the user gets. The web shipped exactly that bug — a failed
      // join destroyed its own error banner — and it is easy to reintroduce
      // because the two lines look independent.
      await _teardown(keepError: 'Could not join the voice channel: $e');
    } finally {
      state = state.copyWith(joining: false);
    }
  }

  Future<void> leave() => _teardown();

  /// [keepError] survives the reset. Everything else about the session does not.
  Future<void> _teardown({String? keepError}) async {
    final ref = state.active;
    final myUid = _myUid;

    await _rosterSub?.cancel();
    await _signalsSub?.cancel();
    _rosterSub = null;
    _signalsSub = null;
    _heartbeatTimer?.cancel();
    _speakingTimer?.cancel();
    _videoStatsTimer?.cancel();
    _heartbeatTimer = null;
    _speakingTimer = null;
    _videoStatsTimer = null;

    for (final uid in _peers.keys.toList()) {
      await _closePeer(uid, deleteSignal: true, reason: 'teardown');
    }
    _peers.clear();
    _answeredOffers.clear();
    _lastLoudAt.clear();

    if (ref != null && myUid != null) {
      await _repo.leaveRoster(ref.groupId, ref.channelId, myUid);
    }

    await VoiceForegroundService.stop();
    await _webrtc.stopStream(_cameraStream);
    await _webrtc.stopStream(_localAudio);
    _cameraStream = null;
    _localAudio = null;

    // Hand the phone's audio routing back, or it can stay stuck in
    // communication mode after hanging up.
    await _nativeAudio(
      'audio routing reset',
      Helper.clearAndroidCommunicationDevice,
    );

    state = VoiceUiState(connError: keepError);
  }

  Future<void> _closePeer(
    String peerUid, {
    bool deleteSignal = false,
    String reason = '?',
  }) async {
    final peer = _peers.remove(peerUid);
    debugPrint('[voice] trace peer:close $peerUid reason=$reason '
        'existed=${peer != null} deleteSignal=$deleteSignal');
    if (peer == null) return;
    await peer.candidatesSub?.cancel();
    try {
      await peer.pc.close();
    } catch (_) {}
    // Dispose the holder stream, and only after the peer connection is closed.
    // Left alive it stays registered in the plugin's localStreams for the rest
    // of the process, still listing tracks that closing the peer connection has
    // already destroyed — which is how a later join ended up resolving a
    // disposed track. See the note in onTrack.
    try {
      await peer.remote?.dispose();
    } catch (_) {}
    peer.remote = null;
    _lastLoudAt.remove(peerUid);

    final ref = state.active;
    final myUid = _myUid;
    if (deleteSignal && ref != null && myUid != null) {
      await _repo.deleteVoiceSignal(
          ref.groupId, ref.channelId, voicePairKey(myUid, peerUid));
    }

    state = state.copyWith(
      remoteStreams: {...state.remoteStreams}..remove(peerUid),
      remoteVideoTracks: {...state.remoteVideoTracks}..remove(peerUid),
      speakingUids: {...state.speakingUids}..remove(peerUid),
    );
  }

  // ---------- mesh ----------

  /// The offerer adds the video transceiver up front, empty, so that turning a
  /// camera on later is a renegotiation-free `replaceTrack`. The answerer must
  /// NOT: adding one on both sides leaves the answerer's transceiver orphaned
  /// (never associated with the offer's m-line) and makes its answer advertise
  /// `recvonly`, which kills video in BOTH directions. The answerer adopts the
  /// offer's transceiver instead — see [_adoptVideoTransceiver].
  Future<_Peer> _createPeerFor(String peerUid, {required bool isOfferer}) async {
    final ref = state.active!;
    final myUid = _myUid!;
    final pc = await _webrtc.createConnection();
    final peer = _Peer(pc);
    debugPrint('[voice] trace peer:create $peerUid isOfferer=$isOfferer');

    if (isOfferer) {
      final tx = await pc.addTransceiver(
        kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
        init: RTCRtpTransceiverInit(direction: TransceiverDirection.SendRecv),
      );
      peer.videoSender = tx.sender;
      // Camera already on before they joined: give their sender the track now,
      // via the same replaceTrack path a later toggle uses.
      final track = _activeVideoTrack();
      if (track != null) {
        try {
          await tx.sender.replaceTrack(track);
        } catch (_) {}
      }
    }

    final audio = _localAudio;
    if (audio != null) {
      for (final t in audio.getAudioTracks()) {
        await pc.addTrack(t, audio);
      }
    }

    final remote = await createLocalMediaStream('remote_$peerUid');
    peer.remote = remote;

    pc.onTrack = (RTCTrackEvent e) async {
      // Always prefer the stream the sender actually signalled. A remote
      // MediaStream is owned by the peer connection and already contains its
      // tracks natively, which is exactly what RTCVideoRenderer needs: it
      // resolves what to draw from the NATIVE stream's videoTracks, so a stream
      // we assembled ourselves only works if the native add also worked.
      //
      // The holder below is the fallback for a track that arrives with no msid,
      // which is what a transceiver added without a stream produces. It is not
      // merely uglier, it is unsafe, and this was the actual "I can't see the
      // screen share" bug:
      //   * the tracks inside it belong to the peer connection, so pc.close()
      //     disposes them while this stream still lists them;
      //   * Chrome re-synthesises the SAME track id for a msid-less
      //     transceiver, so on the next join the plugin's getTrackForId matches
      //     that dead entry first and hands back a disposed track;
      //   * the renderer then throws `MediaStreamTrack has been disposed.` and
      //     the tile stays blank for the rest of the session.
      // Signalling an msid on the sending side is what avoids the whole class,
      // so the fallback should be rare — see the matching change in
      // src/lib/useVoiceChannel.jsx.
      final signalled = e.streams.isNotEmpty ? e.streams.first : null;
      var nativeAdded = true;
      if (signalled == null) {
        // The try/catch is not decoration. `MediaStream.addTrack` appends to
        // the Dart-side list BEFORE calling mediaStreamAddTrack, so a native
        // failure throws with the Dart list already updated — and, uncaught,
        // would abort the rest of this handler and never publish `state`. The
        // tile would then never learn the stream exists at all, which is
        // strictly worse than a blank tile.
        try {
          await remote.addTrack(e.track, addToNative: true);
        } catch (err) {
          nativeAdded = false;
          debugPrint('[voice] native addTrack failed (${e.track.kind}): $err');
        }
      }
      final stream = signalled ?? remote;
      debugPrint(
        '[voice] onTrack kind=${e.track.kind} id=${e.track.id} '
        'streams=${e.streams.length} signalled=${signalled != null} '
        'nativeAdded=$nativeAdded peer=$peerUid',
      );
      if (e.track.kind == 'video') peer.videoTrack = e.track;
      if (e.track.kind == 'audio') _applyOutputTo(e.track, justArrived: true);
      // Published after the stream is resolved, never before: the tile assigns
      // srcObject in response to this, and the renderer reads the stream's
      // track list at that moment.
      state = state.copyWith(
        remoteStreams: {...state.remoteStreams, peerUid: stream},
        remoteVideoTracks: {
          ...state.remoteVideoTracks,
          if (peer.videoTrack != null) peerUid: peer.videoTrack!,
        },
      );
    };

    pc.onIceCandidate = (RTCIceCandidate c) {
      _repo.sendIceCandidate(
        ref.groupId,
        ref.channelId,
        voicePairKey(myUid, peerUid),
        myUid,
        candidateToMap(c),
      );
    };

    pc.onIceConnectionState = (RTCIceConnectionState s) {
      // No ICE-restart flow, same as the 1:1 system: a failed pair drops rather
      // than leaving a dead silent tile.
      if (s == RTCIceConnectionState.RTCIceConnectionStateFailed) {
        _closePeer(peerUid, reason: 'ice-failed');
      }
    };

    _peers[peerUid] = peer;

    peer.candidatesSub = _repo
        .listenCandidates(ref.groupId, ref.channelId, voicePairKey(myUid, peerUid))
        .listen((batch) async {
      for (final c in batch) {
        if (c.from == myUid) continue;
        if (!peer.appliedCandidateIds.add(c.id)) continue;
        final candidate = candidateFromMap(c.candidate);
        if (peer.hasRemoteDescription) {
          try {
            await peer.pc.addCandidate(candidate);
          } catch (_) {}
        } else {
          peer.pending.add(candidate);
        }
      }
    }, onError: (Object e) {
      state = state.copyWith(connError: 'Voice connection signaling failed: $e');
    });

    return peer;
  }

  /// Runs on the ANSWERING side, strictly between `setRemoteDescription` and
  /// `createAnswer`. Finds the transceiver the offer created, widens it to
  /// sendrecv — without which the answer says `recvonly` and both directions of
  /// video die — and keeps its sender so a later camera toggle has somewhere to
  /// put the track.
  ///
  /// Note `setDirection` is asynchronous here, unlike the web's plain property
  /// assignment, so it must be awaited before the answer is created.
  Future<void> _adoptVideoTransceiver(_Peer peer) async {
    final transceivers = await peer.pc.getTransceivers();
    RTCRtpTransceiver? videoTx;
    for (final t in transceivers) {
      if (t.receiver.track?.kind == 'video') {
        videoTx = t;
        break;
      }
    }
    if (videoTx == null) {
      debugPrint('[voice] offer carried no video m-line; audio-only with this peer');
      return;
    }
    await videoTx.setDirection(TransceiverDirection.SendRecv);
    peer.videoSender = videoTx.sender;
    // Covers a camera toggle that landed while we were awaiting above.
    final track = _activeVideoTrack();
    if (track != null) {
      try {
        await videoTx.sender.replaceTrack(track);
      } catch (_) {}
    }
  }

  Future<void> _flushPending(_Peer peer) async {
    peer.hasRemoteDescription = true;
    final pending = [...peer.pending];
    peer.pending.clear();
    for (final c in pending) {
      try {
        await peer.pc.addCandidate(c);
      } catch (_) {}
    }
  }

  Future<void> _offerTo(String peerUid) async {
    final ref = state.active;
    final myUid = _myUid;
    if (ref == null || myUid == null || _peers.containsKey(peerUid)) return;
    try {
      final peer = await _createPeerFor(peerUid, isOfferer: true);
      final offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      // Remember WHICH offer is outstanding. A leftover doc can already carry
      // an answer aimed at a previous, now-closed connection; applying that
      // installs a DTLS fingerprint for a peer that no longer exists, and ICE
      // then reaches `connected` while DTLS sits in `connecting` forever with
      // no error anywhere. Only the answer alongside THIS offer is ours.
      peer.offeredSdp = offer.sdp;
      await _repo.createVoiceOffer(ref.groupId, ref.channelId, myUid, peerUid, {
        'sdp': offer.sdp,
        'type': offer.type,
      });
    } catch (e) {
      state = state.copyWith(connError: "Couldn't reach a participant: $e");
    }
  }

  Future<void> _onSignals(List<VoiceSignal> signals) async {
    final ref = state.active;
    final myUid = _myUid;
    if (ref == null || myUid == null) return;

    for (final sig in signals) {
      final peerUid = sig.peerOf(myUid);
      if (peerUid == null) continue;

      if (sig.offererUid != myUid) {
        // They offer, I answer — once per OFFER, not once per peer. The
        // offerer replaces this doc when it finds a leftover from a crashed
        // session, which is the common case since teardown only runs on a
        // clean leave.
        if (sig.offer == null) continue;
        final offerSdp = sig.offer!['sdp'] as String?;
        final existing = _peers[peerUid];
        final alreadyAnswered = _answeredOffers.containsKey(peerUid) &&
            _answeredOffers[peerUid] == offerSdp;

        if (existing != null) {
          // Same offer: answered already, or still mid-flight answering it.
          if (alreadyAnswered) continue;
          // Different offer: the doc was replaced under us, so this connection
          // is negotiating against an offer that no longer exists. Keep the
          // doc — it holds the offer we are about to answer.
          await _closePeer(peerUid, reason: 'offer-replaced');
        } else if (alreadyAnswered) {
          // No peer, but we DID answer this exact offer. The document already
          // carries that answer and the rule allows only one, so answering
          // again is refused — and retrying on every redelivery is the loop
          // described on [_answeredOffers]. Wait for a genuinely new offer.
          continue;
        }

        // Recorded before the awaits so a redelivery mid-flight is skipped,
        // and kept across a close so the loop above cannot restart.
        _answeredOffers[peerUid] = offerSdp;
        try {
          final peer = await _createPeerFor(peerUid, isOfferer: false);
          peer.answeredOfferSdp = offerSdp;
          await peer.pc.setRemoteDescription(RTCSessionDescription(
            offerSdp,
            sig.offer!['type'] as String?,
          ));
          // Must sit between setRemoteDescription and createAnswer.
          await _adoptVideoTransceiver(peer);
          await _flushPending(peer);
          final answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          final stored = await _repo.attachVoiceAnswer(
              ref.groupId, ref.channelId, sig.pairKey, {
            'sdp': answer.sdp,
            'type': answer.type,
          });
          if (!stored) {
            // Refused, so this answer never landed. Drop the half-built peer,
            // but KEEP the _answeredOffers entry: retrying the same offer would
            // be refused identically. The replacement offer, when it comes,
            // carries different SDP and so passes the guard above.
            await _closePeer(peerUid, reason: 'answer-refused');
          }
        } catch (e) {
          state = state.copyWith(connError: "Couldn't answer a participant: $e");
        }
      } else {
        // I offered — apply their answer, once.
        final peer = _peers[peerUid];
        // `answerApplied` rather than `hasRemoteDescription`: the latter is set
        // by _flushPending, i.e. only after setRemoteDescription has resolved,
        // which leaves that whole span open for a redelivered snapshot to pass
        // the guard too. Both runs then applied the same answer, the second
        // onto an already-stable connection ("Called in wrong state: stable").
        if (peer == null || sig.answer == null || peer.answerApplied) continue;
        // Only the answer paired with the offer we actually wrote. Until our
        // own createVoiceOffer lands, this doc still holds the previous
        // session's offer/answer pair, and that answer is not ours to apply.
        if (peer.offeredSdp == null ||
            (sig.offer?['sdp'] as String?) != peer.offeredSdp) {
          continue;
        }
        peer.answerApplied = true;
        try {
          await peer.pc.setRemoteDescription(RTCSessionDescription(
            sig.answer!['sdp'] as String?,
            sig.answer!['type'] as String?,
          ));
          await _flushPending(peer);
        } catch (e) {
          state = state.copyWith(connError: 'Connection to a participant failed: $e');
        }
      }
    }
  }

  /// The roster's add/remove lists drive peer lifecycle directly. This fires
  /// identically whether "added" means a new joiner or, on the first emission
  /// after I join, somebody already here.
  void _onRoster(RosterUpdate update) {
    final myUid = _myUid;
    state = state.copyWith(participants: update.all);
    if (myUid == null) return;

    for (final uid in update.added) {
      if (uid == myUid || _peers.containsKey(uid)) continue;
      // Exactly one side of each pair offers, decided by uid order, so there is
      // no glare and no negotiation about who goes first.
      if (voiceOffererUid(myUid, uid) == myUid) {
        _offerTo(uid);
      }
      // else: their offer is already on its way to _onSignals.
    }
    for (final uid in update.removed) {
      if (uid == myUid) continue;
      // They left: forget the answered offer so a rejoin negotiates cleanly.
      _answeredOffers.remove(uid);
      _closePeer(uid, reason: 'roster-removed');
    }
  }

  // ---------- controls ----------

  MediaStreamTrack? _activeVideoTrack() {
    final tracks = _cameraStream?.getVideoTracks();
    return (tracks == null || tracks.isEmpty) ? null : tracks.first;
  }

  Future<void> toggleMute() async {
    final track = _localAudio?.getAudioTracks().firstOrNull;
    if (track == null) return;
    final next = !state.muted;
    // track.enabled is the part that actually has to work everywhere; the
    // native call below is a routing nicety on top of it.
    track.enabled = !next;
    await _nativeAudio('mic mute', () => Helper.setMicrophoneMute(next, track));
    // Unmuting while deafened also un-deafens, matching Discord: being heard
    // while unable to hear anyone isn't a state that makes sense.
    final clearDeafen = !next && state.deafened;
    state = state.copyWith(muted: next, deafened: clearDeafen ? false : null);
    if (clearDeafen) _applyOutputToAll();
    _pushRosterState();
  }

  /// Deafen has to disable every remote audio track individually.
  ///
  /// This is the one place the web's design does NOT carry over. There, every
  /// tile is video-only and muted and a single `<audio>` element owns all
  /// playback, so deafen is one property. On Android remote audio plays through
  /// the audio session as soon as the track arrives and RTCVideoView carries no
  /// audio at all — so if this misses a track, that person stays audible while
  /// the UI claims you are deafened.
  Future<void> toggleDeafen() async {
    final next = !state.deafened;
    // Deafening also mutes, as on Discord.
    state = state.copyWith(deafened: next, muted: next ? true : null);
    if (next) {
      final track = _localAudio?.getAudioTracks().firstOrNull;
      if (track != null) {
        track.enabled = false;
        await _nativeAudio(
          'mic mute',
          () => Helper.setMicrophoneMute(true, track),
        );
      }
    }
    _applyOutputToAll();
    _pushRosterState();
  }

  /// [justArrived] marks a track handed to us by `onTrack`.
  ///
  /// **Touching a remote audio track in the instant it arrives aborts the
  /// process.** libwebrtc raises SIGABRT on its own signalling thread; a native
  /// abort cannot be caught, so the try/catch in [_nativeAudio] is no
  /// protection and nothing reaches the logs. It is a race — some joins
  /// survive — which is why it reads as "the app dies when I open voice,
  /// usually".
  ///
  /// Both writes are implicated, not just the volume one: `enabled` is a
  /// fire-and-forget channel call, so its Dart setter returns long before the
  /// native side runs, and a trace showing the setter "completing" proves
  /// nothing about what happens 2ms later.
  ///
  /// The way out is that the write is almost never needed. A remote track
  /// arrives enabled and at full volume already, which is exactly what a
  /// listener who is not deafened wants — so the common path now touches
  /// nothing at all. Only a deafened listener needs it, and even then it waits
  /// for the arrival to settle.
  void _applyOutputTo(MediaStreamTrack track, {bool justArrived = false}) {
    if (!justArrived) {
      track.enabled = !state.deafened;
      unawaited(_nativeAudio(
        'playback volume',
        () => Helper.setVolume(state.deafened ? 0 : 1, track),
      ));
      return;
    }

    if (!state.deafened) return; // nothing to change; do not touch it

    unawaited(Future<void>.delayed(_volumeSettleDelay, () async {
      // Undeafened while we waited, or the session ended: leave it alone.
      if (!mounted || state.active == null || !state.deafened) return;
      track.enabled = false;
      await _nativeAudio('playback volume', () => Helper.setVolume(0, track));
    }));
  }

  void _applyOutputToAll() {
    for (final stream in state.remoteStreams.values) {
      for (final t in stream.getAudioTracks()) {
        _applyOutputTo(t);
      }
    }
  }

  Future<void> toggleCamera() async {
    if (state.cameraOn) {
      for (final peer in _peers.values) {
        try {
          await peer.videoSender?.replaceTrack(null);
        } catch (_) {}
      }
      await _webrtc.stopStream(_cameraStream);
      _cameraStream = null;
      state = state.copyWith(cameraOn: false, clearLocalVideo: true);
      _pushRosterState();
      return;
    }
    try {
      final stream = await _webrtc.getLocalStream(audio: false, video: true);
      _cameraStream = stream;
      final track = stream.getVideoTracks().firstOrNull;
      if (track != null) {
        // replaceTrack on the transceiver added at join time — no renegotiation.
        for (final peer in _peers.values) {
          try {
            await peer.videoSender?.replaceTrack(track);
          } catch (_) {}
        }
      }
      state = state.copyWith(cameraOn: true, localVideoStream: stream);
      _pushRosterState();
    } catch (e) {
      state = state.copyWith(connError: 'Could not start the camera: $e');
    }
  }

  Future<void> switchCamera() async {
    final track = _activeVideoTrack();
    if (track == null) return;
    await _nativeAudio('camera flip', () => Helper.switchCamera(track));
  }

  Future<void> setSpeakerphone(bool on) async {
    // State first so the switch responds immediately; the native call is a
    // routing hint that is allowed to fail (see _nativeAudio) without leaving
    // the toggle stuck mid-flight.
    state = state.copyWith(speakerphone: on);
    await _nativeAudio('speakerphone', () => Helper.setSpeakerphoneOn(on));
  }

  void _pushRosterState() {
    final ref = state.active;
    final myUid = _myUid;
    if (ref == null || myUid == null) return;
    // Only the five keys the update rule permits — anything else is denied.
    _repo.setRosterState(ref.groupId, ref.channelId, myUid, {
      'muted': state.muted,
      'deafened': state.deafened,
      'cameraOn': state.cameraOn,
      'screenSharing': false, // Android watches shares, never sends one.
    });
  }

  // ---------- speaking detection ----------

  /// No Web Audio on mobile, so this reads `audioLevel` out of getStats
  /// instead: inbound-rtp for each peer, media-source for my own mic.
  /// Failures are swallowed — a missing level means "not speaking", never an
  /// error the user sees.
  /// DIAGNOSTIC: dump the inbound video counters for every peer.
  ///
  /// `bytesReceived > 0` with `framesDecoded == 0` means the packets arrive and
  /// the decoder cannot handle them — a codec problem. `bytesReceived == 0`
  /// means nothing is being sent to us at all, which is a negotiation problem.
  Future<void> _logVideoStats() async {
    for (final entry in _peers.entries) {
      try {
        final reports = await entry.value.pc.getStats();
        for (final r in reports) {
          if (r.type == 'inbound-rtp' && r.values['kind'] == 'video') {
            debugPrint(
              '[voice] vstats peer=${entry.key.substring(0, 6)} '
              'bytes=${r.values['bytesReceived']} '
              'packets=${r.values['packetsReceived']} '
              'framesDecoded=${r.values['framesDecoded']} '
              'framesDropped=${r.values['framesDropped']} '
              'frameWidth=${r.values['frameWidth']} '
              'frameHeight=${r.values['frameHeight']} '
              'codec=${r.values['codecId']} '
              'decoder=${r.values['decoderImplementation']}',
            );
          }
          if (r.type == 'codec') {
            final mime = r.values['mimeType'];
            if (mime is String && mime.startsWith('video')) {
              debugPrint('[voice] vcodec ${r.values['codecId'] ?? r.id} $mime');
            }
          }
        }
      } catch (e) {
        debugPrint('[voice] vstats failed: $e');
      }
    }
  }

  Future<void> _pollSpeaking() async {
    final myUid = _myUid;
    if (myUid == null || state.active == null) return;
    final now = DateTime.now();

    Future<void> mark(String uid, double? level) async {
      if (level != null && level > _speakingThreshold) _lastLoudAt[uid] = now;
    }

    for (final entry in _peers.entries) {
      try {
        final reports = await entry.value.pc.getStats();
        double? level;
        for (final r in reports) {
          if (r.type == 'inbound-rtp' && r.values['kind'] == 'audio') {
            final v = r.values['audioLevel'];
            if (v is num) level = v.toDouble();
          }
        }
        await mark(entry.key, level);
      } catch (_) {}
    }

    // My own level comes from any peer connection's media-source; with nobody
    // else here there is no connection to read, and a solo speaker's own glow
    // is not worth holding a connection open for.
    final anyPc = _peers.values.firstOrNull?.pc;
    if (anyPc != null && !state.muted) {
      try {
        final reports = await anyPc.getStats();
        for (final r in reports) {
          if (r.type == 'media-source' && r.values['kind'] == 'audio') {
            final v = r.values['audioLevel'];
            if (v is num) await mark(myUid, v.toDouble());
          }
        }
      } catch (_) {}
    }

    final speaking = <String>{};
    _lastLoudAt.forEach((uid, at) {
      if (now.difference(at) < _speakingHangover) speaking.add(uid);
    });
    if (!setEquals(speaking, state.speakingUids)) {
      state = state.copyWith(speakingUids: speaking);
    }
  }

  @override
  void dispose() {
    _teardown();
    super.dispose();
  }
}

final voiceChannelRepositoryProvider =
    Provider<VoiceChannelRepository>((ref) => VoiceChannelRepository());

/// Who is sitting in one voice channel right now, for the channel list. Read
/// straight from Firestore rather than from [VoiceController], because this has
/// to show a channel you are NOT connected to — seeing that people are already
/// in there is most of the reason to join it.
final voiceRosterProvider = StreamProvider.family<List<VoiceParticipant>,
    ({String groupId, String channelId})>((ref, key) {
  return ref
      .watch(voiceChannelRepositoryProvider)
      .listenParticipants(key.groupId, key.channelId)
      .map((update) => update.all);
});

final voiceControllerProvider =
    StateNotifierProvider<VoiceController, VoiceUiState>(
  (ref) => VoiceController(ref),
);

/// True while the voice room is asking for the entire screen — set when it is
/// on-screen in landscape, which is where the nav chrome costs more than it is
/// worth. [AppShell] hides its own chrome in response, so the video can run
/// edge to edge the way Discord does when you rotate a call.
///
/// A flag rather than the shell deciding for itself: the shell can see the
/// orientation and that a call is live, but not that the voice room is the
/// route you are actually looking at — and hiding the nav bar while someone
/// reads a DM in landscape would be its own bug.
final voiceImmersiveProvider = StateProvider<bool>((_) => false);

/// The channel id of the voice room currently on screen, or null.
///
/// Exists so [VoiceStatusBar] can stand down while the room it describes is
/// already visible. Without it the room's own control row and the status bar
/// both sit on screen in portrait, giving TWO mic/deafen/leave buttons for one
/// piece of state — which is exactly the duplication ProfileSheet refuses to
/// add for the same reason.
///
/// A channel id rather than a bool, deliberately: you can open a voice channel
/// you have NOT joined while connected to a different one, and there the bar is
/// the only thing telling you where you actually are, so it must stay.
final voiceRoomOnScreenProvider = StateProvider<String?>((_) => null);
