import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/voice_participant.dart';

/// Voice-channel signaling — mesh WebRTC, N participants, Firestore as the
/// only transport. 1:1 port of `src/lib/voiceChannel.js`; both clients read and
/// write the same collections, so nothing here may drift from that file or from
/// the `voiceParticipants` / `voiceSignals` rules in firestore.rules.
///
/// Deliberately NOT built on CallsRepository: that collection's ringing and
/// accepted states are 1:1-call-specific. A voice channel has no such
/// lifecycle — people just come and go — so this is a parallel, simpler pair of
/// collections: a presence roster, and pairwise offer/answer/ICE signaling.
///
/// No heartbeat within this long and a roster doc is treated as abandoned —
/// Firestore has no server-side disconnect hook, so a killed app leaves its row
/// behind. Two minutes is deliberately generous: it tolerates a phone
/// suspending timers in the background, which is normal for voice, and pruning
/// someone too eagerly doesn't merely mis-render, it makes every other client
/// tear down its peer connection and actually cuts their audio.
///
/// **Keep in sync with the `duration.value(120, 's')` in firestore.rules'
/// voiceParticipants delete rule, and with STALE_MS on the web.**
const staleAfter = Duration(minutes: 2);

/// Deterministic per-pair key and role. Pure functions of the two uids: both
/// sides compute the same answer independently, with no coordination and no
/// glare window. Same convention as dmConvoId and the 1:1 call pair key.
String voicePairKey(String a, String b) => ([a, b]..sort()).join('__');
String voiceOffererUid(String a, String b) => ([a, b]..sort()).first;

/// What [VoiceChannelRepository.listenParticipants] emits: the full roster plus
/// what changed, so callers drive peer-connection lifecycle off the deltas
/// rather than diffing the roster themselves.
///
/// The FIRST emission after subscribing reports every already-present
/// participant as [added] — Firestore's normal behaviour for a fresh listener,
/// and exactly the "discover who is already here" step a join needs, so there
/// is no separate one-time query.
class RosterUpdate {
  const RosterUpdate(this.all, {this.added = const [], this.removed = const []});

  final List<VoiceParticipant> all;
  final List<String> added;
  final List<String> removed;
}

class VoiceChannelRepository {
  VoiceChannelRepository({FirebaseFirestore? firestore})
    : _db = firestore ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> _participants(String g, String c) =>
      _db.collection('groups').doc(g).collection('channels').doc(c)
          .collection('voiceParticipants');

  DocumentReference<Map<String, dynamic>> _participant(String g, String c, String uid) =>
      _participants(g, c).doc(uid);

  CollectionReference<Map<String, dynamic>> _signals(String g, String c) =>
      _db.collection('groups').doc(g).collection('channels').doc(c)
          .collection('voiceSignals');

  DocumentReference<Map<String, dynamic>> _signal(String g, String c, String pairKey) =>
      _signals(g, c).doc(pairKey);

  // ---------- Roster ----------

  /// Join, deleting any doc of my own first.
  ///
  /// The delete is not tidiness, it is the whole reason this works. Firestore
  /// evaluates a `set` on an ALREADY-EXISTING document against the `update`
  /// rule, not `create`, and the voiceParticipants update rule permits only the
  /// heartbeat and the mute/deafen/camera flags — so a full join payload, which
  /// also carries `uid` and `joinedAt`, is denied. That reads to the user as
  /// "joining instantly kicks me out", and it never recovers on its own:
  /// pruning only runs from clients already connected to the channel, so once a
  /// channel is empty there is nobody left to clear the document blocking
  /// entry. Any force-killed app leaves exactly such a document.
  ///
  /// Deleting first sidesteps it: self-delete is always permitted and is a
  /// no-op when there is nothing there, so the write that follows is always a
  /// genuine create. The delete/add pair is also what other clients need to see
  /// on a real rejoin — tear down the dead peer, build a fresh one.
  Future<void> joinRoster(String groupId, String channelId, String uid) async {
    try {
      await _participant(groupId, channelId, uid).delete();
    } catch (_) {
      // Nothing there, or already gone. Either way the create below is fine.
    }
    await _participant(groupId, channelId, uid).set({
      'uid': uid,
      'joinedAt': FieldValue.serverTimestamp(),
      'lastHeartbeat': FieldValue.serverTimestamp(),
      'muted': false,
      'deafened': false,
      'cameraOn': false,
      'screenSharing': false,
    });
  }

  Future<void> heartbeatRoster(String groupId, String channelId, String uid) async {
    try {
      await _participant(groupId, channelId, uid)
          .update({'lastHeartbeat': FieldValue.serverTimestamp()});
    } catch (_) {
      // A heartbeat that misses is caught by the next one; failing loudly here
      // would turn a transient blip into a torn-down session.
    }
  }

  /// Only the five keys the update rule allows — anything else is denied.
  Future<void> setRosterState(
    String groupId,
    String channelId,
    String uid,
    Map<String, Object?> patch,
  ) async {
    try {
      await _participant(groupId, channelId, uid).update(patch);
    } catch (_) {}
  }

  Future<void> leaveRoster(String groupId, String channelId, String uid) async {
    try {
      await _participant(groupId, channelId, uid).delete();
    } catch (_) {}
  }

  Stream<RosterUpdate> listenParticipants(String groupId, String channelId) {
    return _participants(groupId, channelId)
        .orderBy('joinedAt')
        .snapshots()
        .map((snap) => RosterUpdate(
              snap.docs.map(VoiceParticipant.fromDoc).toList(),
              added: snap.docChanges
                  .where((c) => c.type == DocumentChangeType.added)
                  .map((c) => c.doc.id)
                  .toList(),
              removed: snap.docChanges
                  .where((c) => c.type == DocumentChangeType.removed)
                  .map((c) => c.doc.id)
                  .toList(),
            ));
  }

  /// True when a roster row is old enough to delete. Split out so it can be
  /// tested without Firestore, because the null case is the one that bites:
  /// an unresolved `serverTimestamp()` means "don't know yet", NOT "ancient".
  /// Reading it as epoch zero once made brand-new joiners look infinitely stale
  /// to whichever other client's sweep happened to run in that window, deleting
  /// them within seconds of joining.
  static bool isStale(Timestamp? lastHeartbeat, DateTime now) {
    if (lastHeartbeat == null) return false;
    return now.difference(lastHeartbeat.toDate()) > staleAfter;
  }

  /// Best-effort sweep for rows left behind by killed apps. Safe to run
  /// concurrently from several clients — delete is idempotent, and the rules
  /// re-verify staleness server-side before allowing it.
  Future<void> pruneStaleParticipants(String groupId, String channelId) async {
    try {
      final snap = await _participants(groupId, channelId).get();
      final now = DateTime.now();
      await Future.wait(snap.docs
          .where((d) => isStale(d.data()['lastHeartbeat'] as Timestamp?, now))
          .map((d) async {
            try {
              await d.reference.delete();
            } catch (_) {}
          }));
    } catch (_) {
      // Non-fatal: a failed sweep just leaves the row for the next one.
    }
  }

  // ---------- Pairwise mesh signaling ----------

  /// Called only by whichever side [voiceOffererUid] names; the other waits for
  /// the document to appear.
  Future<String> createVoiceOffer(
    String groupId,
    String channelId,
    String myUid,
    String peerUid,
    Map<String, dynamic> offer,
  ) async {
    final pairKey = voicePairKey(myUid, peerUid);
    await _signal(groupId, channelId, pairKey).set({
      'uids': [myUid, peerUid]..sort(),
      'offererUid': voiceOffererUid(myUid, peerUid),
      'offer': offer,
      'answer': null,
      'createdAt': FieldValue.serverTimestamp(),
    });
    return pairKey;
  }

  Future<void> attachVoiceAnswer(
    String groupId,
    String channelId,
    String pairKey,
    Map<String, dynamic> answer,
  ) async {
    await _signal(groupId, channelId, pairKey).update({'answer': answer});
  }

  Future<void> deleteVoiceSignal(String groupId, String channelId, String pairKey) async {
    try {
      await _signal(groupId, channelId, pairKey).delete();
    } catch (_) {}
  }

  Future<void> sendIceCandidate(
    String groupId,
    String channelId,
    String pairKey,
    String fromUid,
    Map<String, dynamic> candidate,
  ) async {
    try {
      await _signal(groupId, channelId, pairKey).collection('candidates').add({
        'from': fromUid,
        'candidate': candidate,
        'createdAt': FieldValue.serverTimestamp(),
      });
    } catch (_) {}
  }

  /// Emits each newly-added candidate for one pair, not the whole set each
  /// time, so the caller can just add them incrementally.
  Stream<List<({String id, String from, Map<String, dynamic> candidate})>>
      listenCandidates(String groupId, String channelId, String pairKey) {
    return _signal(groupId, channelId, pairKey)
        .collection('candidates')
        .orderBy('createdAt')
        .snapshots()
        .map((snap) => snap.docChanges
            .where((c) => c.type == DocumentChangeType.added)
            .map((c) => (
                  id: c.doc.id,
                  from: (c.doc.data()?['from'] as String?) ?? '',
                  candidate: (c.doc.data()?['candidate'] as Map?)
                          ?.cast<String, dynamic>() ??
                      const <String, dynamic>{},
                ))
            .toList());
  }

  /// Every signaling document involving me in this channel — at most N-1 of
  /// them. One listener drives every peer connection I am part of: it delivers
  /// both incoming offers and answers to offers I sent.
  Stream<List<VoiceSignal>> listenMySignals(
    String groupId,
    String channelId,
    String myUid,
  ) {
    return _signals(groupId, channelId)
        .where('uids', arrayContains: myUid)
        .snapshots()
        .map((snap) => snap.docs.map(VoiceSignal.fromDoc).toList());
  }
}
