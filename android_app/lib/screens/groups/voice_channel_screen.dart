import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../models/user_profile.dart';
import '../../models/voice_participant.dart';
import '../../providers/auth_providers.dart';
import '../../providers/users_providers.dart';
import '../../providers/voice_channel_providers.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../widgets/shared/avatar.dart';

/// Columns for a grid of [n] tiles: `ceil(sqrt(n))`, the same rule as the web.
/// Rows follow from it, so the grid stays square-ish and fills the pane — one
/// person takes the whole area, more divide it.
///
/// The web arrived at this after two wrong turns: fixed-size tiles left a
/// single participant as a small box in a sea of background, and a single
/// stretched track left them as one distorted band.
int voiceGridColumns(int n) => n <= 1 ? 1 : math.sqrt(n).ceil();

/// The room. Port of `src/views/VoiceChannelRoom.jsx`, minus the browser-only
/// extras (document picture-in-picture, pop-out).
///
/// Layout follows the web: a square-ish grid sized from the participant count,
/// both axes as equal fractions, so one person fills the pane and more divide
/// it. A share, when someone on the web starts one, takes the main view and
/// pushes everyone else into a strip — Android watches shares but never sends
/// one.
class VoiceChannelScreen extends ConsumerStatefulWidget {
  const VoiceChannelScreen({
    super.key,
    required this.groupId,
    required this.channelId,
    required this.channelName,
  });

  final String groupId;
  final String channelId;
  final String channelName;

  @override
  ConsumerState<VoiceChannelScreen> createState() => _VoiceChannelScreenState();
}

class _VoiceChannelScreenState extends ConsumerState<VoiceChannelScreen> {
  /// The tile the user pinned by tapping. Once they choose, automatic
  /// spotlighting stops touching the view — the web learned this the hard way:
  /// yanking the view away from someone who has chosen is worse than never
  /// spotlighting at all.
  String? _pinnedUid;
  bool _userChosePin = false;

  /// Who was sharing last time we looked, so a share that just STARTED can be
  /// told apart from one that was already running when we arrived.
  Set<String> _prevSharers = {};

  /// The uid we spotlighted ourselves, so we only auto-unpin our own choice.
  String? _autoPinned;

  void _syncAutoSpotlight(List<VoiceParticipant> participants, String? myUid) {
    final sharers = participants
        .where((p) => p.screenSharing && p.uid != myUid) // never spotlight self
        .map((p) => p.uid)
        .toSet();

    if (!_userChosePin) {
      final started = sharers.difference(_prevSharers);
      if (started.isNotEmpty) {
        _pinnedUid = started.first;
        _autoPinned = _pinnedUid;
      } else if (_autoPinned != null && !sharers.contains(_autoPinned)) {
        // Only ever un-pin a spotlight we set ourselves.
        _pinnedUid = null;
        _autoPinned = null;
      }
    }
    _prevSharers = sharers;
  }

  void _choosePin(String uid) {
    setState(() {
      if (_pinnedUid == uid) {
        _pinnedUid = null;
        _userChosePin = false;
        _autoPinned = null;
      } else {
        _pinnedUid = uid;
        _userChosePin = true;
        _autoPinned = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final voice = ref.watch(voiceControllerProvider);
    final controller = ref.read(voiceControllerProvider.notifier);
    final myUid = ref.watch(profileProvider).valueOrNull?.id;
    final usersById = ref.watch(usersByIdProvider);

    final here = voice.active?.same(widget.groupId, widget.channelId) ?? false;
    final participants = here ? voice.participants : const <VoiceParticipant>[];

    if (here) _syncAutoSpotlight(participants, myUid);

    return Scaffold(
      backgroundColor: Palette.bgDeepest,
      appBar: AppBar(
        title: Row(
          children: [
            const Icon(Icons.volume_up, size: 18, color: Palette.inkDim),
            const SizedBox(width: 6),
            Flexible(
              child: Text(widget.channelName, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
      body: !here
          ? _JoinPrompt(
              channelName: widget.channelName,
              busy: voice.joining,
              error: voice.connError,
              onJoin: () => controller.join(
                widget.groupId,
                widget.channelId,
                widget.channelName,
              ),
            )
          : Column(
              children: [
                if (voice.connError != null)
                  _ErrorBanner(message: voice.connError!),
                Expanded(
                  child: _Tiles(
                    participants: participants,
                    myUid: myUid,
                    pinnedUid: _pinnedUid,
                    onTapTile: _choosePin,
                    voice: voice,
                    usersById: usersById,
                  ),
                ),
                _Controls(voice: voice, controller: controller),
              ],
            ),
    );
  }
}

class _JoinPrompt extends StatelessWidget {
  const _JoinPrompt({
    required this.channelName,
    required this.busy,
    required this.error,
    required this.onJoin,
  });

  final String channelName;
  final bool busy;
  final String? error;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.volume_up, size: 40, color: Palette.inkDim),
            const SizedBox(height: 12),
            Text(channelName, style: AppTextStyles.base()),
            const SizedBox(height: 4),
            Text(
              'Voice channel',
              style: AppTextStyles.sm(color: Palette.inkMuted),
            ),
            if (error != null) ...[
              const SizedBox(height: 12),
              Text(error!, style: AppTextStyles.sm(color: Palette.bad)),
            ],
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: busy ? null : onJoin,
              icon: const Icon(Icons.call),
              label: Text(busy ? 'Connecting…' : 'Join voice'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Palette.bad.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Text(message, style: AppTextStyles.xs(color: Palette.bad)),
    );
  }
}

class _Tiles extends StatelessWidget {
  const _Tiles({
    required this.participants,
    required this.myUid,
    required this.pinnedUid,
    required this.onTapTile,
    required this.voice,
    required this.usersById,
  });

  final List<VoiceParticipant> participants;
  final String? myUid;
  final String? pinnedUid;
  final void Function(String uid) onTapTile;
  final VoiceUiState voice;
  final Map<String, UserProfile> usersById;

  @override
  Widget build(BuildContext context) {
    if (participants.isEmpty) {
      return Center(
        child: Text(
          'Nobody here yet.',
          style: AppTextStyles.sm(color: Palette.inkMuted),
        ),
      );
    }

    final pinned = pinnedUid == null
        ? null
        : participants.where((p) => p.uid == pinnedUid).firstOrNull;

    if (pinned != null) {
      final others = participants.where((p) => p.uid != pinned.uid).toList();
      return Column(
        children: [
          Expanded(child: _tile(pinned, big: true)),
          if (others.isNotEmpty)
            SizedBox(
              height: 96,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                itemCount: others.length,
                itemBuilder: (_, i) => SizedBox(
                  width: 128,
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: _tile(others[i]),
                  ),
                ),
              ),
            ),
        ],
      );
    }

    final cols = voiceGridColumns(participants.length);
    return Padding(
      padding: const EdgeInsets.all(6),
      child: GridView.builder(
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: cols,
          mainAxisSpacing: 6,
          crossAxisSpacing: 6,
          // Rows are derived so the grid fills the pane rather than leaving a
          // band of dead space under a single tile.
          childAspectRatio: 1,
        ),
        itemCount: participants.length,
        itemBuilder: (_, i) => _tile(participants[i]),
      ),
    );
  }

  Widget _tile(VoiceParticipant p, {bool big = false}) {
    final isSelf = p.uid == myUid;
    final stream = isSelf
        ? voice.localVideoStream
        : voice.remoteStreams[p.uid];
    final track = isSelf ? null : voice.remoteVideoTracks[p.uid];
    // A participant who has left the workspace still has to render: usersById
    // is the unfiltered directory for exactly this reason.
    final name = usersById[p.uid]?.name ?? 'Someone';

    return _VoiceTile(
      key: ValueKey('tile_${p.uid}'),
      participant: p,
      name: name,
      isSelf: isSelf,
      speaking: voice.speakingUids.contains(p.uid),
      stream: stream,
      videoTrack: track,
      onTap: () => onTapTile(p.uid),
      big: big,
    );
  }
}

/// One participant.
///
/// Two rules carried over from the web, both learned from bugs:
///
/// * What gets rendered is decided by whether a video TRACK exists, never by
///   the roster's `cameraOn`/`screenSharing` flag. If a single roster write is
///   lost, video that is already flowing must still appear. The flag only picks
///   contain-vs-cover once something is on screen.
/// * A received video track arrives long before anyone shares — the transceiver
///   is added empty at join — and sits muted with no frames. When it unmutes
///   there is no new track event, so the renderer has to be re-attached on
///   [MediaStreamTrack.onUnMute] or the tile stays blank permanently.
class _VoiceTile extends StatefulWidget {
  const _VoiceTile({
    super.key,
    required this.participant,
    required this.name,
    required this.isSelf,
    required this.speaking,
    required this.stream,
    required this.videoTrack,
    required this.onTap,
    required this.big,
  });

  final VoiceParticipant participant;
  final String name;
  final bool isSelf;
  final bool speaking;
  final MediaStream? stream;
  final MediaStreamTrack? videoTrack;
  final VoidCallback onTap;
  final bool big;

  @override
  State<_VoiceTile> createState() => _VoiceTileState();
}

class _VoiceTileState extends State<_VoiceTile> {
  final _renderer = RTCVideoRenderer();
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _renderer.initialize().then((_) {
      if (mounted) setState(() => _ready = true);
      _attach();
    });
  }

  @override
  void didUpdateWidget(covariant _VoiceTile old) {
    super.didUpdateWidget(old);
    if (old.stream != widget.stream || old.videoTrack != widget.videoTrack) {
      _attach();
    }
  }

  void _attach() {
    if (!_ready) return;
    _renderer.srcObject = widget.stream;
    // The re-attach that keeps a share from staying blank: the track object
    // does not change when it starts carrying frames, so nothing else would
    // tell us to look again.
    widget.videoTrack?.onUnMute = () {
      if (!mounted) return;
      _renderer.srcObject = widget.stream;
      setState(() {});
    };
  }

  @override
  void dispose() {
    widget.videoTrack?.onUnMute = null;
    _renderer.srcObject = null;
    _renderer.dispose();
    super.dispose();
  }

  bool get _hasVideo {
    final tracks = widget.stream?.getVideoTracks() ?? const [];
    // `muted == true` means the track exists but no frames are flowing, which
    // is the normal state before anyone turns anything on.
    return tracks.isNotEmpty && tracks.first.muted != true;
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.participant;
    return GestureDetector(
      onTap: widget.onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Palette.bgRaised,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: widget.speaking ? Palette.ok : Colors.transparent,
            width: 2,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (_ready && _hasVideo)
              RTCVideoView(
                _renderer,
                mirror: widget.isSelf && !p.screenSharing,
                objectFit: p.screenSharing
                    // A share centre-cropped reads as "stuck zoomed in".
                    ? RTCVideoViewObjectFit.RTCVideoViewObjectFitContain
                    : RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
              )
            else
              Center(
                child: Avatar(name: widget.name, size: widget.big ? 72 : 40),
              ),
            Positioned(
              left: 6,
              right: 6,
              bottom: 6,
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      widget.isSelf ? '${widget.name} (you)' : widget.name,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.xs(color: Palette.ink),
                    ),
                  ),
                  if (p.muted)
                    const Icon(Icons.mic_off, size: 13, color: Palette.bad),
                  if (p.deafened)
                    const Icon(Icons.headset_off, size: 13, color: Palette.bad),
                  if (p.screenSharing)
                    const Icon(Icons.screen_share,
                        size: 13, color: Palette.brand),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({required this.voice, required this.controller});

  final VoiceUiState voice;
  final VoiceController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      color: Palette.bgDark,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _CtlButton(
            icon: voice.muted ? Icons.mic_off : Icons.mic,
            label: voice.muted ? 'Unmute' : 'Mute',
            active: voice.muted,
            onTap: controller.toggleMute,
          ),
          _CtlButton(
            icon: voice.deafened ? Icons.headset_off : Icons.headset,
            label: 'Deafen',
            active: voice.deafened,
            onTap: controller.toggleDeafen,
          ),
          _CtlButton(
            icon: voice.cameraOn ? Icons.videocam : Icons.videocam_off,
            label: 'Camera',
            active: voice.cameraOn,
            onTap: controller.toggleCamera,
          ),
          if (voice.cameraOn)
            _CtlButton(
              icon: Icons.cameraswitch,
              label: 'Flip',
              onTap: controller.switchCamera,
            ),
          _CtlButton(
            icon: Icons.call_end,
            label: 'Leave',
            danger: true,
            onTap: controller.leave,
          ),
        ],
      ),
    );
  }
}

class _CtlButton extends StatelessWidget {
  const _CtlButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    this.danger = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = danger
        ? Palette.bad
        : active
            ? Palette.warn
            : Palette.ink;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color),
            const SizedBox(height: 3),
            Text(label, style: AppTextStyles.xs(color: Palette.inkDim)),
          ],
        ),
      ),
    );
  }
}
