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

  /// True when this device's clock cannot be trusted to judge staleness.
  ///
  /// `lastHeartbeat` is a serverTimestamp, so comparing it against a local
  /// DateTime.now() is only sound while the two agree. Two anchors, both of
  /// which mean "refuse to delete anybody":
  ///
  ///   1. My own row looks stale. It is rewritten every 15s, so it never can
  ///      legitimately — my clock runs fast, or my writes are failing, and
  ///      either way every OTHER row looks stale too.
  ///   2. I am not in this channel (the list sweeps ones I have not joined)
  ///      and EVERY row looks stale. That is what a fast clock looks like; it
  ///      is also a channel everyone genuinely crashed out of, and the two are
  ///      indistinguishable from here. Ghosts in a list are cosmetic and the
  ///      next person to JOIN clears them via anchor 1; evicting a live
  ///      channel is not.
  ///
  /// This matters most for admins: the voiceParticipants delete rule lets
  /// adminOverGroup through WITHOUT the server-side staleness re-check (it has
  /// to, so deleting a channel can clear its roster), so an admin is the one
  /// client whose bad clock the server will not catch.
  static bool clockLooksWrong(
    List<Timestamp?> heartbeats,
    Timestamp? mine,
    DateTime now,
  ) {
    if (mine != null) return isStale(mine, now);
    final known = heartbeats.whereType<Timestamp>().toList();
    if (known.isEmpty) return false;
    return known.every((h) => isStale(h, now));
  }

  /// Best-effort sweep for rows left behind by killed apps. Safe to run
  /// concurrently from several clients — delete is idempotent, and the rules
  /// re-verify staleness server-side before allowing it.
  Future<void> pruneStaleParticipants(
    String groupId,
    String channelId, [
    String? myUid,
  ]) async {
    try {
      final snap = await _participants(groupId, channelId).get();
      final now = DateTime.now();
      final heartbeats =
          snap.docs.map((d) => d.data()['lastHeartbeat'] as Timestamp?).toList();
      Timestamp? mine;
      for (final d in snap.docs) {
        if (d.id == myUid) mine = d.data()['lastHeartbeat'] as Timestamp?;
      }
      if (clockLooksWrong(heartbeats, mine, now)) return;

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
    final ref = _signal(groupId, channelId, pairKey);
    final payload = <String, dynamic>{
      'uids': [myUid, peerUid]..sort(),
      'offererUid': voiceOffererUid(myUid, peerUid),
      'offer': offer,
      'answer': null,
      'createdAt': FieldValue.serverTimestamp(),
    };

    // Try the write first, and clear a leftover doc only if it is refused. Do
    // NOT hoist the delete above this.
    //
    // `set` on a doc that ALREADY EXISTS is evaluated against the `update`
    // rule, not `create`. voiceSignals' update rule allows exactly one thing —
    // the NON-offerer attaching `answer` — so an offerer writing its full
    // payload over a leftover doc is denied, and stays denied forever. Leftover
    // docs are the normal case: teardown only runs on a clean leave, so any
    // client that crashed or was killed leaves one behind.
    //
    // Deleting unconditionally fixed that and introduced a worse-behaved bug:
    // it leaves a window with no doc at all, and the ANSWERER's `answer` write
    // is an `update`, which matches no rule when the doc is missing. Answering
    // takes hundreds of ms, so that window got hit routinely — "Couldn't answer
    // a participant: permission-denied". Recovering only on refusal keeps the
    // common path gap-free.
    //
    // Mirrors src/lib/voiceChannel.js. Both clients write this doc.
    //
    // Clear leftover candidates BEFORE publishing the offer, never after. The
    // answerer cannot produce candidates for a negotiation it has not seen
    // yet, so everything in there right now belongs to a dead session and
    // nothing in flight can be lost. Sweeping afterwards would race the peer's
    // own trickle and delete live candidates.
    await _clearCandidates(ref);

    try {
      await ref.set(payload);
    } on FirebaseException catch (e) {
      if (e.code != 'permission-denied') rethrow;
      try {
        await ref.delete();
      } catch (_) {}
      await ref.set(payload);
    }
    return pairKey;
  }

  /// Returns true when the answer was stored, false when the write was refused.
  ///
  /// The `update` rule permits exactly one write — the non-offerer attaching
  /// `answer` to a doc that has none yet — so it is denied in two situations
  /// that are both NORMAL rather than exceptional:
  ///
  ///   1. The doc is GONE, because [createVoiceOffer]'s recovery path deleted a
  ///      leftover and re-offered; an update matches no rule with nothing there.
  ///   2. The doc already HAS an answer, having been replaced and answered.
  ///
  /// Either way the answer being written is stale, which is not an error — so
  /// report the refusal and let the caller re-answer the replacement offer.
  /// Throwing here is what surfaced as "Couldn't answer a participant: Missing
  /// or insufficient permissions" while leaving the pair permanently silent.
  ///
  /// Mirrors src/lib/voiceChannel.js.
  Future<bool> attachVoiceAnswer(
    String groupId,
    String channelId,
    String pairKey,
    Map<String, dynamic> answer,
  ) async {
    try {
      await _signal(groupId, channelId, pairKey).update({'answer': answer});
      return true;
    } on FirebaseException catch (e) {
      if (e.code != 'permission-denied') rethrow;
      return false;
    }
  }

  /// Firestore does not cascade, so a pair's ICE candidates outlive the
  /// signalling doc unless something clears them, and are then replayed into
  /// the NEXT negotiation for that pair — all pointing at ports from a session
  /// that no longer exists. One real pair was found carrying 23.
  Future<void> _clearCandidates(DocumentReference<Map<String, dynamic>> ref) async {
    try {
      final stale = await ref.collection('candidates').get();
      await Future.wait(stale.docs.map((d) async {
        try {
          await d.reference.delete();
        } catch (_) {}
      }));
    } catch (_) {
      // Best effort: never block the caller on a failed sweep.
    }
  }

  /// Deletes a pair's signalling doc and its candidates. Same reasoning as
  /// deleteChannel's subcollection clearing in src/lib/groups.js.
  ///
  /// Teardown alone cannot fully win the race: the peer keeps trickling
  /// candidates until it notices we left, so a few land after this sweep and
  /// outlive the doc. [createVoiceOffer] does the authoritative clear.
  Future<void> deleteVoiceSignal(String groupId, String channelId, String pairKey) async {
    final ref = _signal(groupId, channelId, pairKey);
    await _clearCandidates(ref);
    try {
      await ref.delete();
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
