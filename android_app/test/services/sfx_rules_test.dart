import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/providers/calls_providers.dart' show CallStatus;
import 'package:punx_messenger/services/sfx_rules.dart';
import 'package:punx_messenger/services/sfx_service.dart';

void main() {
  group('call sounds', () {
    Sfx? play(CallStatus a, CallStatus b) => callSoundActions(a, b).play;

    test('the whole life of a call', () {
      expect(play(CallStatus.idle, CallStatus.incoming), Sfx.ring);
      expect(play(CallStatus.idle, CallStatus.outgoing), Sfx.ringback);
      expect(
        play(CallStatus.incoming, CallStatus.connected),
        Sfx.callConnected,
      );
      expect(
        play(CallStatus.outgoing, CallStatus.connected),
        Sfx.callConnected,
      );
      expect(play(CallStatus.connected, CallStatus.idle), Sfx.callEnded);
    });

    test('an unanswered or declined outgoing call ends audibly', () {
      expect(play(CallStatus.outgoing, CallStatus.idle), Sfx.callEnded);
    });

    test('an incoming call that stops ringing is silent', () {
      // I declined it, or the caller gave up — it is already quiet.
      expect(play(CallStatus.incoming, CallStatus.idle), isNull);
    });

    test('every change stops any ring; no change does nothing', () {
      const both = [Sfx.ring, Sfx.ringback];
      for (final (p, n) in [
        (CallStatus.idle, CallStatus.incoming),
        (CallStatus.incoming, CallStatus.connected),
        (CallStatus.outgoing, CallStatus.idle),
        (CallStatus.connected, CallStatus.idle),
        (CallStatus.incoming, CallStatus.idle),
      ]) {
        expect(callSoundActions(p, n).stop, both, reason: '$p -> $n');
      }
      final same = callSoundActions(CallStatus.connected, CallStatus.connected);
      expect(same.stop, isEmpty);
      expect(same.play, isNull);
    });
  });

  group('voice roster sounds', () {
    List<Sfx> roster({
      bool primed = true,
      bool deafened = false,
      List<String> added = const [],
      List<String> removed = const [],
    }) => rosterSounds(
      primed: primed,
      deafened: deafened,
      myUid: 'me',
      added: added,
      removed: removed,
    );

    test('someone else joining or leaving makes a tick', () {
      expect(roster(added: ['ana']), [Sfx.peerJoin]);
      expect(roster(removed: ['ana']), [Sfx.peerLeave]);
      expect(roster(added: ['ana'], removed: ['ben']), [
        Sfx.peerJoin,
        Sfx.peerLeave,
      ]);
    });

    test('a burst of joiners is one sound, not one each', () {
      expect(roster(added: ['a', 'b', 'c', 'd', 'e']), [Sfx.peerJoin]);
    });

    test('the first snapshot (everyone already here) is silent', () {
      expect(roster(primed: false, added: ['ana', 'ben', 'cal']), isEmpty);
    });

    test('my own appearance is not a "peer" joining', () {
      expect(roster(added: ['me']), isEmpty);
      expect(roster(removed: ['me']), isEmpty);
      expect(roster(added: ['me', 'ana']), [Sfx.peerJoin]);
    });

    test('deafened means you hear nobody come or go', () {
      expect(roster(deafened: true, added: ['ana'], removed: ['ben']), isEmpty);
    });

    test('nothing changed, nothing to hear', () {
      expect(roster(), isEmpty);
    });
  });

  group('DM ping', () {
    bool due({
      int? last,
      int stamp = 100,
      bool inFront = true,
      bool viewing = false,
    }) => dmPingDue(
      lastPingedStamp: last,
      stamp: stamp,
      appInFront: inFront,
      viewingThisConversation: viewing,
    );

    test('a new message pings', () {
      expect(due(), isTrue);
      expect(due(last: 50), isTrue, reason: 'newer than the last one pinged');
    });

    test(
      'the same message again does not — a typing update re-delivers it',
      () {
        expect(due(last: 100), isFalse);
      },
    );

    test('not for the conversation you are already reading', () {
      expect(due(viewing: true), isFalse);
    });

    test('not in the background, where the system notification speaks', () {
      expect(due(inFront: false), isFalse);
    });
  });
}
