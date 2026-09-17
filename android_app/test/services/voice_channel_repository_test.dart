import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/services/voice_channel_repository.dart';

/// The pure parts of voice signaling. Both are load-bearing in ways that fail
/// silently rather than loudly, which is why they are worth pinning down
/// without Firestore in the way.
void main() {
  group('pair key and role', () {
    // Every client computes these independently, with no coordination. If two
    // peers ever disagreed about who offers, they would either both offer
    // (glare, and one connection is discarded) or neither would, and the pair
    // would sit silent forever with nothing in any log to say why.
    test('both sides derive the same pair key, whichever order they ask in', () {
      expect(voicePairKey('alice', 'bob'), voicePairKey('bob', 'alice'));
      expect(voicePairKey('zed', 'aaa'), voicePairKey('aaa', 'zed'));
    });

    test('both sides name the same offerer, whichever order they ask in', () {
      expect(voiceOffererUid('alice', 'bob'), voiceOffererUid('bob', 'alice'));
      expect(voiceOffererUid('zed', 'aaa'), 'aaa');
    });

    test('exactly one of a pair considers itself the offerer', () {
      const pairs = [
        ['alice', 'bob'],
        ['ZZZ', 'aaa'],       // case matters to sort(); still exactly one
        ['uid-1', 'uid-10'],  // string sort, not numeric
      ];
      for (final p in pairs) {
        final iAmOfferer = voiceOffererUid(p[0], p[1]) == p[0];
        final theyAreOfferer = voiceOffererUid(p[1], p[0]) == p[1];
        expect(iAmOfferer, isNot(theyAreOfferer), reason: '${p[0]} vs ${p[1]}');
      }
    });

    test('the key contains both uids and the separator', () {
      expect(voicePairKey('alice', 'bob'), 'alice__bob');
    });
  });

  group('staleness', () {
    final now = DateTime(2026, 8, 27, 12, 0, 0);
    Timestamp ago(Duration d) => Timestamp.fromDate(now.subtract(d));

    test('an unresolved heartbeat is NOT stale', () {
      // The bug this exists to prevent: serverTimestamp() reads back null for a
      // moment after a join, and treating that as epoch zero made a brand-new
      // joiner look infinitely old to another client's sweep, which deleted
      // them seconds after they arrived. "Don't know" is not "gone".
      expect(VoiceChannelRepository.isStale(null, now), isFalse);
    });

    test('a fresh heartbeat is not stale', () {
      expect(VoiceChannelRepository.isStale(ago(const Duration(seconds: 5)), now), isFalse);
    });

    test('still not stale just inside the window', () {
      // Generous on purpose: a backgrounded phone suspends timers, and pruning
      // someone who is still talking cuts their audio for everyone.
      expect(VoiceChannelRepository.isStale(ago(const Duration(seconds: 119)), now), isFalse);
    });

    test('stale past the window', () {
      expect(VoiceChannelRepository.isStale(ago(const Duration(seconds: 121)), now), isTrue);
    });

    test('the window matches what firestore.rules enforces', () {
      // The rules allow the delete only after duration.value(120, 's'). If this
      // constant drifts past that, clients would attempt deletes the server
      // refuses; if it drifts under, rows linger. Neither is loud.
      expect(staleAfter, const Duration(seconds: 120));
    });
  });

  // `lastHeartbeat` is a serverTimestamp compared against a LOCAL clock, so a
  // device running fast judges healthy rows to be ancient. Non-admins are
  // caught by the rules' own request.time re-check; admins are not, because
  // that clause has to stay open for deleteChannel. These are the guards that
  // stand in for the check the server will not make.
  group('clock sanity before pruning', () {
    final now = DateTime.utc(2026, 1, 1, 12, 0, 0);
    Timestamp ago(Duration d) => Timestamp.fromDate(now.subtract(d));
    final fresh = ago(const Duration(seconds: 10));
    final ancient = ago(const Duration(minutes: 30));

    test('a healthy row of my own means the clock is fine', () {
      expect(
        VoiceChannelRepository.clockLooksWrong([fresh, ancient], fresh, now,
            joined: true),
        isFalse,
      );
    });

    test('my own row reading as stale means the clock is wrong', () {
      // It is rewritten every 15s, so this cannot legitimately happen —
      // while I am in the channel, which is what `joined` asserts.
      expect(
        VoiceChannelRepository.clockLooksWrong([ancient, ancient], ancient, now,
            joined: true),
        isTrue,
      );
    });

    test('my own STALE row is not a clock anchor when I am not joined', () {
      // The ghost case, and the bug this guards. A force-killed app leaves a
      // row bearing my uid; teardown only runs on a clean leave. Read as an
      // anchor it claims my clock is broken and aborts the sweep, which made
      // my own leftover the one row that could never be cleared from a list.
      // Somebody else is plainly alive here, so nothing is wrong with anyone's
      // clock and the sweep must proceed.
      expect(
        VoiceChannelRepository.clockLooksWrong([ancient, fresh], ancient, now),
        isFalse,
      );
    });

    test('my own FRESH row is not a clock anchor when I am not joined', () {
      // Seconds after a force-kill this is what the leftover looks like, and
      // it is why the age test alone never caught it. Still not an anchor:
      // `joined` is the only thing that says whether the row is mine-and-live.
      expect(
        VoiceChannelRepository.clockLooksWrong([fresh, ancient], fresh, now),
        isFalse,
      );
    });

    test('sweeping a channel I am not in: a mix is trustworthy', () {
      expect(
        VoiceChannelRepository.clockLooksWrong([fresh, ancient], null, now),
        isFalse,
      );
    });

    test('sweeping a channel I am not in: all-stale is refused', () {
      // Indistinguishable from a fast clock, so the whole channel would go.
      expect(
        VoiceChannelRepository.clockLooksWrong([ancient, ancient], null, now),
        isTrue,
      );
    });

    test('an empty channel is not a clock problem', () {
      expect(VoiceChannelRepository.clockLooksWrong([], null, now), isFalse);
    });

    test('unresolved serverTimestamps are ignored, not read as ancient', () {
      // A brand-new joiner's row reads back null for a moment. Counting that
      // as stale is what once deleted people seconds after they joined.
      expect(VoiceChannelRepository.clockLooksWrong([null, null], null, now), isFalse);
      expect(VoiceChannelRepository.clockLooksWrong([null, fresh], null, now), isFalse);
    });
  });
}
