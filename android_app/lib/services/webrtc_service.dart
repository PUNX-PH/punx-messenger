import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../config/app_config.dart';

/// Raw WebRTC plumbing — no Firestore/Riverpod knowledge here on purpose,
/// mirrors src/lib/webrtc.js. Signaling lives in services/calls_repository.dart,
/// the two are glued together by providers/calls_providers.dart.
/// The on-the-wire shape of an ICE candidate in Firestore. Shared by the 1:1
/// call system and by voice channels, and matched field-for-field by the web
/// (`src/lib/webrtc.js`) — both clients read each other's candidates, so this
/// is a contract, not an implementation detail. One copy on purpose.
Map<String, dynamic> candidateToMap(RTCIceCandidate c) => {
  'candidate': c.candidate,
  'sdpMid': c.sdpMid,
  'sdpMLineIndex': c.sdpMLineIndex,
};

RTCIceCandidate candidateFromMap(Map<String, dynamic> m) => RTCIceCandidate(
  m['candidate'] as String?,
  m['sdpMid'] as String?,
  m['sdpMLineIndex'] as int?,
);

class WebrtcService {
  // Named createConnection (not createPeerConnection) so it doesn't shadow
  // the package-level createPeerConnection() this delegates to.
  /// [iceServers] overrides the compiled-in STUN list — pass the resolved list
  /// from [TurnService] so a pair that cannot connect directly has a relay.
  /// Omitting it keeps the STUN-only behaviour.
  Future<RTCPeerConnection> createConnection({
    List<Map<String, dynamic>>? iceServers,
  }) {
    return createPeerConnection({
      'iceServers': iceServers ?? AppConfig.iceServers,
    }, const {});
  }

  Future<MediaStream> getLocalStream({bool audio = true, bool video = true}) {
    return navigator.mediaDevices.getUserMedia({
      'audio': audio,
      'video': video ? {'facingMode': 'user'} : false,
    });
  }

  Future<void> stopStream(MediaStream? stream) async {
    if (stream == null) return;
    for (final track in stream.getTracks()) {
      await track.stop();
    }
    await stream.dispose();
  }
}
