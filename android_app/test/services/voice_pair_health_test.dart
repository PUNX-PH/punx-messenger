import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/services/voice_pair_health.dart';

void main() {
  final t0 = DateTime(2026, 1, 1, 12);
  DateTime at(int s) => t0.add(Duration(seconds: s));

  PairVerdict obs(PairHealthTracker t, int s, int bytes, {bool offerer = true}) =>
      t.observe('bob', bytes: bytes, iAmOfferer: offerer, now: at(s));

  test('growing bytes are healthy', () {
    final t = PairHealthTracker();
    expect(obs(t, 0, 100), PairVerdict.healthy);
    expect(obs(t, 4, 900), PairVerdict.healthy);
  });

  test('a stall waits out the window before repairing', () {
    final t = PairHealthTracker();
    expect(obs(t, 0, 100), PairVerdict.healthy);
    expect(obs(t, 4, 100), PairVerdict.waiting);
    expect(obs(t, 8, 100), PairVerdict.waiting);
    expect(obs(t, 12, 100), PairVerdict.repair);
  });

  test('a pair that never connects is repaired a bounded number of times', () {
    final t = PairHealthTracker();
    obs(t, 0, 0); // first sighting: nothing received yet
    var repairs = 0;
    PairVerdict last = PairVerdict.waiting;
    // Every tick reports 0 bytes, as a rebuilt-but-dead connection does. If the
    // counter reset on that (the -1 bug), repairs would never stop.
    for (var s = 4; s <= 400; s += 4) {
      last = obs(t, s, 0);
      if (last == PairVerdict.repair) repairs++;
    }
    expect(repairs, 3);
    expect(last, PairVerdict.gaveUp);
  });

  test('recovery restores the full repair budget', () {
    final t = PairHealthTracker();
    obs(t, 0, 0);
    expect(obs(t, 12, 0), PairVerdict.repair);
    expect(obs(t, 16, 500), PairVerdict.healthy); // audio came back
    // Stalls again later: gets a fresh budget, not the remaining 2. A rebuilt
    // connection starts again from zero bytes, so model that after each repair.
    var repairs = 0;
    var bytes = 500;
    for (var s = 20; s <= 400; s += 4) {
      if (obs(t, s, bytes) == PairVerdict.repair) {
        repairs++;
        bytes = 0;
      }
    }
    expect(repairs, 3);
  });

  test('the answerer never repairs, however long the silence', () {
    final t = PairHealthTracker();
    obs(t, 0, 0, offerer: false);
    for (var s = 4; s <= 200; s += 4) {
      expect(obs(t, s, 0, offerer: false), PairVerdict.healthy);
    }
  });

  test('forget starts a pair over; pairs are tracked independently', () {
    final t = PairHealthTracker();
    obs(t, 0, 0);
    expect(obs(t, 12, 0), PairVerdict.repair);
    t.forget('bob');
    expect(obs(t, 13, 0), PairVerdict.healthy); // first sighting again
    expect(
      t.observe('carol', bytes: 0, iAmOfferer: true, now: at(13)),
      PairVerdict.healthy,
    );
  });
}
