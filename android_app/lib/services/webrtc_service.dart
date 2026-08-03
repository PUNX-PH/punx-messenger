import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../config/app_config.dart';

/// Raw WebRTC plumbing — no Firestore/Riverpod knowledge here on purpose,
/// mirrors src/lib/webrtc.js. Signaling lives in services/calls_repository.dart,
/// the two are glued together by providers/calls_providers.dart.
class WebrtcService {
  // Named createConnection (not createPeerConnection) so it doesn't shadow
  // the package-level createPeerConnection() this delegates to.
  Future<RTCPeerConnection> createConnection() {
    return createPeerConnection({
      'iceServers': AppConfig.iceServers,
    }, const {});
  }

  Future<MediaStream> getLocalStream({bool video = true}) {
    return navigator.mediaDevices.getUserMedia({
      'audio': true,
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
