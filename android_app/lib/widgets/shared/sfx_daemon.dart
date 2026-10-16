import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/calls_providers.dart';
import '../../providers/sfx_providers.dart';
import '../../providers/voice_channel_providers.dart';
import '../../services/sfx_rules.dart';
import '../../services/sfx_service.dart';

/// Non-visual, mounted once in AppShell beside the other daemons.
///
/// Two jobs. It readies the sounds when the app opens — before any call can
/// exist, which matters (see [AudioplayersBackend]). And it turns the call's
/// status into ring, ringback and the connected/ended chimes. It lives here
/// rather than in the incoming-call screen because the ring has to outlast any
/// one screen: it keeps sounding if you navigate, and stops the moment the call
/// does.
class SfxDaemon extends ConsumerStatefulWidget {
  const SfxDaemon({super.key});

  @override
  ConsumerState<SfxDaemon> createState() => _SfxDaemonState();
}

class _SfxDaemonState extends ConsumerState<SfxDaemon> {
  late final SfxService _sfx = ref.read(sfxServiceProvider);
  bool _voiceConnected = false;

  @override
  void initState() {
    super.initState();
    // A call already ringing when the app opens has no "change" to react to, so
    // once the sounds are ready, react to where it is now.
    unawaited(
      _sfx.init().then((_) {
        if (!mounted) return;
        _onStatus(CallStatus.idle, ref.read(callControllerProvider).status);
      }),
    );
  }

  void _onStatus(CallStatus prev, CallStatus next) {
    // Before anything plays: the sound that goes with a call CONNECTING must be
    // judged as live, and the one that goes with it ENDING as not.
    _sfx.setLiveAudio(isLiveAudio(call: next, voiceConnected: _voiceConnected));
    final actions = callSoundActions(prev, next);
    for (final s in actions.stop) {
      unawaited(_sfx.stop(s));
    }
    final play = actions.play;
    if (play != null) _sfx.play(play);
  }

  @override
  void dispose() {
    // Never leave a ring running behind a screen that has gone away.
    unawaited(_sfx.stop(Sfx.ring));
    unawaited(_sfx.stop(Sfx.ringback));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Loads the saved on/off choice into the service as soon as the app opens.
    ref.watch(sfxEnabledProvider);

    ref.listen<CallStatus>(
      callControllerProvider.select((s) => s.status),
      (prev, next) => _onStatus(prev ?? CallStatus.idle, next),
    );
    ref.listen<bool>(voiceControllerProvider.select((v) => v.connected), (
      _,
      connected,
    ) {
      _voiceConnected = connected;
      _sfx.setLiveAudio(
        isLiveAudio(
          call: ref.read(callControllerProvider).status,
          voiceConnected: connected,
        ),
      );
    });
    return const SizedBox.shrink();
  }
}
