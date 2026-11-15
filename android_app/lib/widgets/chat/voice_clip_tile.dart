import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/voice_clip.dart';
import '../../providers/voice_playback_providers.dart';
import '../../services/voice_playback.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// A voice message in the list: a play/pause button, how far along it is (drag to
/// move), and the time. Port of VoicePlayer.jsx.
///
/// It will not play while a call or a voice channel is live: the phone's one
/// audio session belongs to that call, and a second player taking it could cut the
/// call's sound (the same caution the sound effects take, sfx_service.dart).
class VoiceClipTile extends ConsumerStatefulWidget {
  const VoiceClipTile({super.key, required this.clip});

  final VoiceClip clip;

  @override
  ConsumerState<VoiceClipTile> createState() => _VoiceClipTileState();
}

class _VoiceClipTileState extends ConsumerState<VoiceClipTile> {
  late VoiceClipController _c = _make();

  VoiceClipController _make() => VoiceClipController(
    widget.clip,
    ref.read(voicePlayerFactoryProvider),
    isIPhone: !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS,
  )..addListener(_changed);

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(VoiceClipTile old) {
    super.didUpdateWidget(old);
    if (old.clip.dataUrl != widget.clip.dataUrl) {
      _c
        ..removeListener(_changed)
        ..dispose();
      _c = _make();
    }
  }

  @override
  void dispose() {
    _c
      ..removeListener(_changed)
      ..dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (!_c.playing && ref.read(liveAudioProvider)) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(
          content: Text('Leave the call to listen to voice messages.'),
        ),
      );
      return;
    }
    await _c.toggle();
  }

  @override
  Widget build(BuildContext context) {
    final shown = _c.total;
    final maxMs = shown.inMilliseconds > 0 ? shown.inMilliseconds : 1;
    final atMs = _c.position.inMilliseconds.clamp(0, maxMs);
    final started = _c.playing || _c.position > Duration.zero;
    final label = _c.failed
        ? "Can't play"
        : started
        ? '${formatVoiceDuration(atMs)} / ${formatVoiceDuration(shown.inMilliseconds)}'
        : formatVoiceDuration(shown.inMilliseconds);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Semantics(
        container: true,
        label: 'Voice message',
        child: Container(
          constraints: const BoxConstraints(maxWidth: 320),
          padding: const EdgeInsets.fromLTRB(6, 4, 12, 4),
          decoration: BoxDecoration(
            color: Palette.bgDeepest,
            border: Border.all(color: Palette.lineSubtle),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(
                button: true,
                label: _c.playing
                    ? 'Pause voice message'
                    : 'Play voice message',
                child: InkWell(
                  onTap: _toggle,
                  customBorder: const CircleBorder(),
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: _c.failed ? Palette.inkDim : Palette.brand,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      _c.failed
                          ? Icons.error_outline
                          : (_c.playing ? Icons.pause : Icons.play_arrow),
                      size: 20,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
              Flexible(
                child: SizedBox(
                  width: 140,
                  child: Slider(
                    value: atMs.toDouble(),
                    min: 0,
                    max: maxMs.toDouble(),
                    onChanged: _c.failed
                        ? null
                        : (v) => _c.seek(Duration(milliseconds: v.round())),
                  ),
                ),
              ),
              Text(
                label,
                style: AppTextStyles.xs(color: Palette.inkMuted),
                maxLines: 1,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
