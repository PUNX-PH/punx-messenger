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
}
