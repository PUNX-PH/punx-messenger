import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/sfx_rules.dart';
import '../services/voice_playback.dart';
import 'calls_providers.dart';
import 'voice_channel_providers.dart';

/// Makes the player for one voice message (overridden in tests with a fake).
final voicePlayerFactoryProvider = Provider<VoicePlayerFactory>(
  (ref) =>
      () => AudioplayersVoiceBackend(),
);

/// Is a call or a voice channel live right now? While it is, voice messages are
/// not played (and not recorded): the phone's audio belongs to the call.
final liveAudioProvider = Provider<bool>(
  (ref) => isLiveAudio(
    call: ref.watch(callControllerProvider.select((s) => s.status)),
    voiceConnected: ref.watch(voiceControllerProvider.select((v) => v.connected)),
  ),
);
