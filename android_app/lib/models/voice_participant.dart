import 'package:cloud_firestore/cloud_firestore.dart';

/// One row of a voice channel's roster —
/// `groups/{groupId}/channels/{channelId}/voiceParticipants/{uid}`, doc id is
/// the participant's uid. Mirrors what joinRoster writes in
/// src/lib/voiceChannel.js; both clients share this collection, so the field
/// names are a contract with the web app and with firestore.rules.
class VoiceParticipant {
  const VoiceParticipant({
    required this.uid,
    this.joinedAt,
    this.lastHeartbeat,
    this.muted = false,
    this.deafened = false,
    this.cameraOn = false,
    this.screenSharing = false,
  });

  final String uid;
  final Timestamp? joinedAt;

  /// Written on a timer. Its absence is meaningful: a `serverTimestamp()` reads
  /// back null for a moment after a join, and treating that as "very old" is
  /// what once made fresh joiners get pruned seconds after arriving. See
  /// [VoiceChannelRepository.pruneStaleParticipants].
  final Timestamp? lastHeartbeat;

  final bool muted;
  final bool deafened;
  final bool cameraOn;

  /// Android can watch a screen share but never sends one, so this is only ever
  /// true here for a participant on the web.
  final bool screenSharing;

  factory VoiceParticipant.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) =>
      VoiceParticipant.fromMap(doc.id, doc.data() ?? const <String, dynamic>{});

  factory VoiceParticipant.fromMap(String id, Map<String, dynamic> data) {
    return VoiceParticipant(
      uid: (data['uid'] as String?) ?? id,
      joinedAt: data['joinedAt'] as Timestamp?,
      lastHeartbeat: data['lastHeartbeat'] as Timestamp?,
      muted: data['muted'] == true,
      deafened: data['deafened'] == true,
      cameraOn: data['cameraOn'] == true,
      screenSharing: data['screenSharing'] == true,
    );
  }

  /// True when this participant has some video to show. The tile still decides
  /// what to RENDER from the track itself, never from this — a lost roster
  /// write must not be able to hide a share whose frames are already arriving.
  /// This only picks contain-vs-cover once something is on screen.
  bool get hasVideoFlag => cameraOn || screenSharing;
}

/// One pair's offer/answer document, `voiceSignals/{pairKey}`.
///
/// There is no ring/accept lifecycle here, unlike `calls/{callId}`: who offers
/// is a pure function of the two uids, so both sides agree with no coordination
/// and there is no glare window. See [voiceOffererUid].
class VoiceSignal {
  const VoiceSignal({
    required this.pairKey,
    required this.uids,
    required this.offererUid,
    this.offer,
    this.answer,
  });

  final String pairKey;
  final List<String> uids;
  final String offererUid;

  /// `{sdp, type}` maps, exactly as the web writes them.
  final Map<String, dynamic>? offer;
  final Map<String, dynamic>? answer;

  factory VoiceSignal.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? const <String, dynamic>{};
    return VoiceSignal(
      pairKey: doc.id,
      uids: List<String>.from(data['uids'] as List? ?? const []),
      offererUid: (data['offererUid'] as String?) ?? '',
      offer: (data['offer'] as Map?)?.cast<String, dynamic>(),
      answer: (data['answer'] as Map?)?.cast<String, dynamic>(),
    );
  }

  /// The other party, or null if this document doesn't involve [myUid].
  String? peerOf(String myUid) {
    for (final u in uids) {
      if (u != myUid) return u;
    }
    return null;
  }
}
