/// What to do about one mesh pair, given how much audio it has delivered.
///
/// Port of the repair rules in `src/lib/useVoiceChannel.jsx` (repairTick). Kept
/// free of WebRTC so the decisions can be tested directly; the controller only
/// feeds it byte counts and acts on the verdict.
///
/// Why this exists at all: ICE can blip and never recover without ever reaching
/// `failed`, an offer whose answer never arrives never starts ICE, and the DTLS
/// trap in docs/VOICE.md leaves ICE `connected` and DTLS `connecting` forever.
/// All three look healthy from the outside and all three deliver zero bytes.
enum PairVerdict {
  /// Audio is arriving (or this side is not the one that repairs).
  healthy,

  /// No audio yet, but not for long enough to call it dead.
  waiting,

  /// Stalled past the window — close the pair and offer again.
  repair,

  /// Stalled, and the repair budget for this pair is spent.
  gaveUp,
}

class PairHealthTracker {
  PairHealthTracker({
    this.stall = const Duration(seconds: 12),
    this.maxRepairs = 3,
  });

  /// Generous on purpose: it also covers a pair that has not finished
  /// connecting, and a relayed candidate pair over TURN can take several
  /// seconds. Tearing one down mid-negotiation turns slow into never.
  final Duration stall;

  /// Reset the moment audio flows again, so a pair that recovers keeps its full
  /// budget; a pair that genuinely cannot connect stops instead of churning.
  final int maxRepairs;

  // Lives here, outside the peer: a retry whose memory dies with the thing being
  // retried is an infinite loop.
  final Map<String, _PairState> _pairs = {};

  /// [bytes] is the pair's total inbound audio bytes right now.
  PairVerdict observe(
    String peerUid, {
    required int bytes,
    required bool iAmOfferer,
    required DateTime now,
  }) {
    final st = _pairs.putIfAbsent(peerUid, () => _PairState(now));

    if (bytes > st.lastBytes) {
      st.lastBytes = bytes;
      st.lastProgressAt = now;
      st.attempts = 0; // audio is flowing; earlier trouble no longer counts
      return PairVerdict.healthy;
    }

    // Only the deterministic offerer repairs. An answerer's re-offer would name
    // the other side as offerer and be refused by the voiceSignals create rule —
    // after tearing down a negotiation the real offerer was still running.
    if (!iAmOfferer) return PairVerdict.healthy;

    if (now.difference(st.lastProgressAt) < stall) return PairVerdict.waiting;
    if (st.attempts >= maxRepairs) return PairVerdict.gaveUp;

    st.attempts += 1;
    st.lastProgressAt = now;
    // 0, not -1: the rebuilt connection starts at zero bytes, and -1 would read
    // that as progress on the next tick and reset `attempts` every time, so the
    // cap would never bind.
    st.lastBytes = 0;
    return PairVerdict.repair;
  }

  /// A pair that genuinely ended (they left, or the mesh was rebuilt). NOT called
  /// on a repair — the attempt count has to survive the rebuild.
  void forget(String peerUid) => _pairs.remove(peerUid);

  void clear() => _pairs.clear();
}

class _PairState {
  _PairState(this.lastProgressAt);

  int lastBytes = -1;
  int attempts = 0;
  DateTime lastProgressAt;
}
