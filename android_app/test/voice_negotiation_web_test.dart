@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

/// Proves the video-transceiver handshake that voice channels depend on, using
/// two REAL peer connections.
///
/// Why this test exists, and why it runs in a browser: on the web this exact
/// mistake shipped and survived for months, presenting as "screen share works
/// when I share but not when they do". The cause was that BOTH sides pre-added
/// a video transceiver. On the answering side that runs before the offer is
/// applied, and the pre-created transceiver does not carry its sendrecv intent
/// into the answer: the answer comes out **recvonly**, which in turn drops the
/// OFFERER to sendonly. Video then fails in both directions at once, which is
/// why it read as inconsistent between people — which side broke depended on
/// uid ordering, since that is what picks the offerer.
///
/// Nothing about that is Android-specific — it is how the WebRTC spec
/// associates transceivers — so proving it here proves the logic in
/// VoiceController. It cannot run under plain `flutter test`, which has no
/// platform channels and therefore no peer connections; in a browser
/// flutter_webrtc wraps the browser's own implementation.
///
///   flutter test --platform chrome test/voice_negotiation_web_test.dart
///
/// Deliberately media-free: the bug lives in the SDP directions, so no camera,
/// microphone or permission prompt is needed.
///
/// NOTE: `flutter test --platform chrome` did not run to completion in the
/// sandbox this was written in — it produced no output in twenty minutes. The
/// same handshake was therefore executed as plain JavaScript against two real
/// RTCPeerConnections in a browser, which is where the expectations below come
/// from: the correct sequence yields a sendrecv answer with the offerer still
/// sendrecv, and pre-adding on both sides yields a recvonly answer with the
/// offerer dropped to sendonly. What remains unverified is the flutter_webrtc
/// BINDING of that sequence, which is what this file would prove if run.
void main() {
  Future<RTCPeerConnection> newPc() =>
      createPeerConnection({'iceServers': const []});

  /// The direction the answer advertises for video, read straight out of the
  /// SDP. This is the line that was wrong.
  String? videoDirectionIn(String sdp) {
    var inVideo = false;
    for (final line in sdp.split(RegExp(r'\r?\n'))) {
      if (line.startsWith('m=')) inVideo = line.startsWith('m=video');
      if (!inVideo) continue;
      for (final d in ['sendrecv', 'sendonly', 'recvonly', 'inactive']) {
        if (line == 'a=$d') return d;
      }
    }
    return null;
  }

  test('the answerer adopts the offer transceiver and answers sendrecv',
      () async {
    final offerer = await newPc();
    final answerer = await newPc();

    // OFFERER: pre-adds the transceiver, so a later camera toggle is a
    // renegotiation-free replaceTrack.
    final offerTx = await offerer.addTransceiver(
      kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
      init: RTCRtpTransceiverInit(direction: TransceiverDirection.SendRecv),
    );

    final offer = await offerer.createOffer();
    await offerer.setLocalDescription(offer);

    // ANSWERER: must NOT pre-add. Apply the offer, then adopt what it created.
    await answerer.setRemoteDescription(
      RTCSessionDescription(offer.sdp, offer.type),
    );

    final transceivers = await answerer.getTransceivers();
    final videoTx = transceivers
        .where((t) => t.receiver.track?.kind == 'video')
        .firstOrNull;
    expect(videoTx, isNotNull,
        reason: 'the offer should have created a video transceiver to adopt');

    // The line that makes the answer say sendrecv instead of recvonly.
    await videoTx!.setDirection(TransceiverDirection.SendRecv);

    final answer = await answerer.createAnswer();
    await answerer.setLocalDescription(answer);
    await offerer.setRemoteDescription(
      RTCSessionDescription(answer.sdp, answer.type),
    );

    expect(videoDirectionIn(answer.sdp!), 'sendrecv',
        reason: 'a recvonly answer is what killed video in BOTH directions');

    expect(await offerTx.getCurrentDirection(), TransceiverDirection.SendRecv,
        reason: 'the offerer must stay able to receive, not drop to sendonly');
    expect(await videoTx.getCurrentDirection(), TransceiverDirection.SendRecv);

    await offerer.close();
    await answerer.close();
  });

  test('pre-adding on BOTH sides reproduces the bug this guards against',
      () async {
    // The negative case, so the assertion above cannot quietly stop meaning
    // anything if someone "tidies up" the asymmetry between the two sides.
    final offerer = await newPc();
    final answerer = await newPc();

    final offerTx = await offerer.addTransceiver(
      kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
      init: RTCRtpTransceiverInit(direction: TransceiverDirection.SendRecv),
    );
    // The mistake: the answerer adds its own before seeing the offer.
    await answerer.addTransceiver(
      kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
      init: RTCRtpTransceiverInit(direction: TransceiverDirection.SendRecv),
    );

    final offer = await offerer.createOffer();
    await offerer.setLocalDescription(offer);
    await answerer.setRemoteDescription(
      RTCSessionDescription(offer.sdp, offer.type),
    );

    final answer = await answerer.createAnswer();
    await answerer.setLocalDescription(answer);
    await offerer.setRemoteDescription(
      RTCSessionDescription(answer.sdp, answer.type),
    );

    // Measured against real peer connections rather than assumed: the damage
    // is entirely in the DIRECTIONS, not in the m-line count. There is still
    // exactly one video m-line — an earlier version of this test asserted a
    // second, orphaned one and was simply wrong.
    expect(videoDirectionIn(answer.sdp!), 'recvonly',
        reason: 'a transceiver added before the offer is applied does not '
            'carry its sendrecv intent into the answer');
    expect(await offerTx.getCurrentDirection(), TransceiverDirection.SendOnly,
        reason: 'and that recvonly answer is what drops the OFFERER to '
            'sendonly, so neither side can receive');

    await offerer.close();
    await answerer.close();
  });
}
