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
}

class VoiceController extends StateNotifier<VoiceUiState> {
  VoiceController(this._ref) : super(const VoiceUiState());
  final Ref _ref;

  VoiceChannelRepository get _repo => _ref.read(voiceChannelRepositoryProvider);
  WebrtcService get _webrtc => _ref.read(webrtcServiceProvider);

  String? get _myUid => _ref.read(profileProvider).valueOrNull?.id;

  final Map<String, _Peer> _peers = {};
  MediaStream? _localAudio;
  MediaStream? _cameraStream;
  StreamSubscription<RosterUpdate>? _rosterSub;
  StreamSubscription<List<VoiceSignal>>? _signalsSub;
  Timer? _heartbeatTimer;
  Timer? _speakingTimer;
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
      await Helper.ensureAudioSession();
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
        _repo.pruneStaleParticipants(groupId, channelId);
      });
      _speakingTimer = Timer.periodic(_speakingPoll, (_) => _pollSpeaking());

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
    _heartbeatTimer = null;
    _speakingTimer = null;

    for (final uid in _peers.keys.toList()) {
      await _closePeer(uid, deleteSignal: true);
    }
    _peers.clear();
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
    try {
      await Helper.clearAndroidCommunicationDevice();
    } catch (_) {}

    state = VoiceUiState(connError: keepError);
  }

  Future<void> _closePeer(String peerUid, {bool deleteSignal = false}) async {
    final peer = _peers.remove(peerUid);
    if (peer == null) return;
    await peer.candidatesSub?.cancel();
    try {
      await peer.pc.close();
    } catch (_) {}
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
      // addToNative: false — this is a holder for tracks we received, not a
      // stream we are publishing.
      await remote.addTrack(e.track, addToNative: false);
      if (e.track.kind == 'video') peer.videoTrack = e.track;
      if (e.track.kind == 'audio') _applyOutputTo(e.track);
      state = state.copyWith(
        remoteStreams: {...state.remoteStreams, peerUid: remote},
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
        _closePeer(peerUid);
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
        // They offer, I answer — once. An existing entry means I already have.
        if (_peers.containsKey(peerUid) || sig.offer == null) continue;
        try {
          final peer = await _createPeerFor(peerUid, isOfferer: false);
          await peer.pc.setRemoteDescription(RTCSessionDescription(
            sig.offer!['sdp'] as String?,
            sig.offer!['type'] as String?,
          ));
          // Must sit between setRemoteDescription and createAnswer.
          await _adoptVideoTransceiver(peer);
          await _flushPending(peer);
          final answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          await _repo.attachVoiceAnswer(ref.groupId, ref.channelId, sig.pairKey, {
            'sdp': answer.sdp,
            'type': answer.type,
          });
        } catch (e) {
          state = state.copyWith(connError: "Couldn't answer a participant: $e");
        }
      } else {
        // I offered — apply their answer, once.
        final peer = _peers[peerUid];
        if (peer == null || sig.answer == null || peer.hasRemoteDescription) continue;
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
      _closePeer(uid);
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
    track.enabled = !next;
    try {
      await Helper.setMicrophoneMute(next, track);
    } catch (_) {}
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
        try {
          await Helper.setMicrophoneMute(true, track);
        } catch (_) {}
      }
    }
    _applyOutputToAll();
    _pushRosterState();
  }

  void _applyOutputTo(MediaStreamTrack track) {
    try {
      Helper.setVolume(state.deafened ? 0 : 1, track);
    } catch (_) {}
    track.enabled = !state.deafened;
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
    try {
      await Helper.switchCamera(track);
    } catch (_) {}
  }

  Future<void> setSpeakerphone(bool on) async {
    try {
      await Helper.setSpeakerphoneOn(on);
    } catch (_) {}
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
