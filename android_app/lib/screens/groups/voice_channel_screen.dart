import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

/// Height of the control bar that floats over the video in fullscreen, kept as
/// the space the tiles must leave for it. A compact [_CtlButton] is a 24px icon
/// in 8px of padding, inside a 2px-padded bar; the rest is breathing room so a
/// tile's name label does not sit right against a button.
const double _fsControlsHeight = 60;

/// Same idea for the labelled bar: a 24px icon, its label, and the padding
/// around both. The tiles reserve this so the control bar can be stacked over
/// them in one layout rather than needing a separate Column for each mode.
const double _controlsHeight = 84;

/// Corner radius shared by a tile's card and the ClipRRect around its video.
/// One constant on purpose: they have to match, and the video needs its own
/// clip because the card's clipBehavior cannot reach a texture/platform view.
const double _tileRadius = 10;

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

  /// Held from initState so [dispose] can clear it without touching `ref`
  /// after the element is defunct. Failing to clear it would leave the shell
  /// with no nav bar on every other tab.
  late final StateController<bool> _immersiveCtl;

  bool _immersive = false;

  /// Explicit fullscreen choice, overriding the orientation default.
  ///
  /// Three states on purpose. `null` means "follow the orientation" — landscape
  /// fills the screen, portrait does not — which is the sensible default and
  /// what rotating a Discord call does. `true` is fullscreen asked for by hand,
  /// so portrait can use the whole screen too. `false` is chrome asked for by
  /// hand, so the exit button still works in landscape instead of being a
  /// button that visibly does nothing.
  ///
  /// Cleared on rotation: turning the phone is a fresh instruction, and a
  /// choice made in one orientation should not silently govern the other.
  bool? _fullscreenOverride;
  Orientation? _lastOrientation;

  void _setFullscreen(bool want) {
    setState(() => _fullscreenOverride = want);
  }

  @override
  void initState() {
    super.initState();
    _immersiveCtl = ref.read(voiceImmersiveProvider.notifier);
  }

  @override
  void dispose() {
    if (_immersive) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    }
    // Deferred, not written here: dispose runs inside the tree's unmount phase
    // and Riverpod rejects a provider write during a build — "Tried to modify a
    // provider while the widget tree was building". The controller is captured
    // in a local because `this` is defunct by the time the callback runs.
    final ctl = _immersiveCtl;
    WidgetsBinding.instance.addPostFrameCallback((_) => ctl.state = false);
    super.dispose();
  }

  /// Landscape in the room means fullscreen video, the way rotating a Discord
  /// call does. Both halves have to move together: the system bars here, and
  /// the shell's nav chrome through the provider.
  void _syncImmersive(bool want) {
    if (want == _immersive) return;
    _immersive = want;
    SystemChrome.setEnabledSystemUIMode(
      want ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge,
    );
    // Never during build — the shell rebuilds off this.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _immersiveCtl.state = want;
    });
  }

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

    final orientation = MediaQuery.orientationOf(context);
    final landscape = orientation == Orientation.landscape;
    if (_lastOrientation != null && _lastOrientation != orientation) {
      _fullscreenOverride = null;
    }
    _lastOrientation = orientation;

    // Only once actually in the room: the join prompt is a normal screen and
    // taking its app bar away would strand you with no way back.
    final immersive = here && (_fullscreenOverride ?? landscape);
    _syncImmersive(immersive);

    // ONE Scaffold for both modes, deliberately. Returning a separate Scaffold
    // for fullscreen tore the whole subtree down on every toggle — every tile,
    // every renderer, every ConsumerWidget under it. That is not just wasteful:
    // a roster snapshot landing mid-teardown reached an unmounted consumer and
    // crashed with `_lifecycleState != _ElementLifecycle.defunct`. Keeping the
    // body in one position means the toggle only changes decoration.
    return Scaffold(
      backgroundColor: immersive ? Colors.black : Palette.bgDeepest,
      appBar: immersive
          ? null
          : AppBar(
              title: Row(
                children: [
                  const Icon(Icons.volume_up, size: 18, color: Palette.inkDim),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      widget.channelName,
                      overflow: TextOverflow.ellipsis,
                    ),
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
          : SafeArea(
              // The system bars are hidden in fullscreen, so their insets are
              // the only thing keeping the overlay buttons off the very edge.
              top: immersive,
              bottom: !immersive,
              child: LayoutBuilder(
                builder: (context, c) {
                  // Landscape on a phone leaves ~360 logical px of height for
                  // the whole room. Labelled controls plus a full-size strip do
                  // not fit in that, so the chrome gives way to the video
                  // rather than the other way round.
                  final compact = immersive || c.maxHeight < 420;
                  return Stack(
                    children: [
                      // Reserve the control bar's height in both modes: the bar
                      // is stacked over the tiles, and without this the
                      // thumbnail strip runs under it and the first button ends
                      // up behind someone's tile.
                      Positioned.fill(
                        child: Padding(
                          padding: EdgeInsets.only(
                            bottom: compact
                                ? _fsControlsHeight
                                : _controlsHeight,
                            top: voice.connError != null ? 32 : 0,
                          ),
                          child: _Tiles(
                            participants: participants,
                            myUid: myUid,
                            pinnedUid: _pinnedUid,
                            onTapTile: _choosePin,
                            voice: voice,
                            usersById: usersById,
                          ),
                        ),
                      ),
                      if (voice.connError != null)
                        Positioned(
                          top: 0,
                          left: 0,
                          right: 0,
                          child: _ErrorBanner(message: voice.connError!),
                        ),
                      // Fullscreen has no app bar, so it needs its own way back
                      // and its own way out. Rotating upright also works, but
                      // that must not be the only route.
                      if (immersive) ...[
                        Positioned(
                          top: 4,
                          left: 4,
                          child: _ScrimIconButton(
                            icon: Icons.arrow_back,
                            onTap: () => Navigator.of(context).maybePop(),
                          ),
                        ),
                        Positioned(
                          top: 4,
                          right: 4,
                          child: _ScrimIconButton(
                            icon: Icons.fullscreen_exit,
                            onTap: () => _setFullscreen(false),
                          ),
                        ),
                      ],
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: immersive
                            ? DecoratedBox(
                                decoration: const BoxDecoration(
                                  gradient: LinearGradient(
                                    begin: Alignment.bottomCenter,
                                    end: Alignment.topCenter,
                                    colors: [
                                      Colors.black54,
                                      Colors.transparent,
                                    ],
                                  ),
                                ),
                                child: _Controls(
                                  voice: voice,
                                  controller: controller,
                                  compact: true,
                                  transparent: true,
                                ),
                              )
                            : _Controls(
                                voice: voice,
                                controller: controller,
                                compact: compact,
                                onEnterFullscreen: () => _setFullscreen(true),
                              ),
                      ),
                    ],
                  );
                },
              ),
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

    // Everything here is measured rather than assumed. The old fixed numbers
    // (96px strip, square grid cells) were sized for a portrait phone: in
    // landscape the viewport is only ~360 logical px tall, the strip alone ate
    // all of it, the spotlight tile was squeezed to zero and the column
    // overflowed. A share has to stay watchable on whatever box it is given.
    return LayoutBuilder(
      builder: (context, c) {
        final landscape = c.maxWidth > c.maxHeight;

        if (pinned != null) {
          final others =
              participants.where((p) => p.uid != pinned.uid).toList();
          if (others.isEmpty) {
            return Padding(
              padding: const EdgeInsets.all(6),
              child: _tile(pinned, big: true),
            );
          }
          // Wide and short: put the others down the side, so the full height
          // stays available to the video, which is the scarce axis there.
          if (landscape) {
            final stripW = (c.maxWidth * 0.18).clamp(84.0, 148.0);
            return Row(
              children: [
                Expanded(child: _tile(pinned, big: true)),
                SizedBox(
                  width: stripW,
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    itemCount: others.length,
                    itemBuilder: (_, i) => AspectRatio(
                      aspectRatio: 1,
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
          // Portrait: strip along the bottom, but never more than a fifth of
          // the height, and dropped entirely when there is not enough room for
          // both it and a usable spotlight.
          final roomForStrip = c.maxHeight > 220;
          final stripH = (c.maxHeight * 0.2).clamp(64.0, 96.0);
          return Column(
            children: [
              Expanded(child: _tile(pinned, big: true)),
              if (roomForStrip)
                SizedBox(
                  height: stripH,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    itemCount: others.length,
                    itemBuilder: (_, i) => AspectRatio(
                      aspectRatio: 1,
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

        // Unpinned grid. `childAspectRatio: 1` assumed the pane was roughly
        // square; on a landscape phone square cells are taller than the pane
        // and a non-scrolling grid just overflows. Deriving the ratio from the
        // real cell size makes the grid fill whatever it is given instead.
        final cols = voiceGridColumns(participants.length);
        final rows = (participants.length / cols).ceil();
        const gap = 6.0;
        final cellW = (c.maxWidth - gap * (cols + 1)) / cols;
        final cellH = (c.maxHeight - gap * (rows + 1)) / rows;
        return Padding(
          padding: const EdgeInsets.all(gap),
          child: GridView.builder(
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: cols,
              mainAxisSpacing: gap,
              crossAxisSpacing: gap,
              childAspectRatio:
                  cellH > 0 && cellW > 0 ? cellW / cellH : 1,
            ),
            itemCount: participants.length,
            itemBuilder: (_, i) => _tile(participants[i]),
          ),
        );
      },
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
      // Do NOT make this a GlobalKey. Tried, reverted: the intent was to let
      // one tile State follow a participant between the spotlight, the grid
      // and the strip, but this tree builds the same participant's tile twice
      // over at least one frame. A GlobalKey has to be unique, so the duplicate
      // made Flutter deactivate one copy and setState then landed on a defunct
      // element — a hard crash, on top of the recreation it failed to stop.
      // Whatever is rebuilding these tiles has to be found first.
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
      // The renderer reports its dimensions as frames arrive; that is what
      // decides whether the avatar comes off, rather than any single flag.
      _renderer.addListener(_onRendererChanged);
      _attach();
    });
  }

  void _onRendererChanged() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(covariant _VoiceTile old) {
    super.didUpdateWidget(old);
    if (old.stream != widget.stream || old.videoTrack != widget.videoTrack) {
      _attach();
    }
  }

  Future<void> _attach() async {
    if (!_ready) return;
    final stream = widget.stream;
    final track = widget.videoTrack;
    // setSrcObject rather than `srcObject =`: the plain setter sends no trackId
    // at all, so the native side falls back to videoTracks[0] of the stream.
    // Naming the track is exact, and it is the difference once a peer's holder
    // stream has carried more than one video track over a session.
    try {
      await _renderer.setSrcObject(stream: stream, trackId: track?.id);
    } catch (err) {
      debugPrint('[voice] tile setSrcObject failed for ${widget.name}: $err');
    }
    // The re-attach that keeps a share from staying blank: the track object
    // does not change when it starts carrying frames, so nothing else would
    // tell us to look again.
    track?.onUnMute = () {
      if (!mounted) return;
      _attach();
    };
  }

  @override
  void dispose() {
    widget.videoTrack?.onUnMute = null;
    _renderer.removeListener(_onRendererChanged);
    _renderer.srcObject = null;
    _renderer.dispose();
    super.dispose();
  }

  /// Whether there is a video track at all — which is what decides that the
  /// view gets mounted, so it can start receiving. Never the roster's
  /// cameraOn/screenSharing flag: a single lost roster write must not be able
  /// to hide video whose frames are already arriving.
  bool get _hasVideoTrack =>
      (widget.stream?.getVideoTracks() ?? const []).isNotEmpty;

  /// Whether frames are actually arriving, measured from the renderer's own
  /// reported size rather than inferred from a track flag.
  ///
  /// The web learned this twice. `track.muted` is true for the whole window
  /// between a transceiver being created empty and someone starting to share,
  /// and it is not always cleared promptly — trusting it left the placeholder
  /// covering perfectly good video with no way to recover. A non-zero size
  /// cannot be wrong in that direction: there are pixels or there aren't.
  bool get _live => _renderer.value.width > 0 && _renderer.value.height > 0;

  @override
  Widget build(BuildContext context) {
    final p = widget.participant;
    final tile = _card(p);
    // The web renders a share into a landscape pane, so `contain` barely
    // letterboxes and the tile reads as full. A phone is portrait: the same
    // 16:9 share inside a tall tile leaves two fat empty bands inside the card,
    // which is what "it doesn't fit like the web" looks like. Hugging the
    // video's own aspect ratio gets the web's result here — as wide as the
    // screen allows, with nothing dead inside the card.
    //
    // Only for the big tile, and only once frames have actually arrived:
    // RTCVideoValue.aspectRatio reports 1.0 while the size is still unknown,
    // and squaring the tile off on that would be a visible jump.
    if (widget.big && _live) {
      return Center(
        child: AspectRatio(
          aspectRatio: _renderer.value.aspectRatio,
          child: tile,
        ),
      );
    }
    return tile;
  }

  Widget _card(VoiceParticipant p) {
    return GestureDetector(
      onTap: widget.onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Palette.bgRaised,
          borderRadius: BorderRadius.circular(_tileRadius),
          border: Border.all(
            color: widget.speaking ? Palette.ok : Colors.transparent,
            width: 2,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          fit: StackFit.expand,
          children: [
            // Mounted as soon as a track exists so it can start receiving,
            // with the avatar laid over the top until frames actually arrive.
            if (_ready && _hasVideoTrack)
              // Its own ClipRRect, matching the card's radius. The Container's
              // clipBehavior does not reach the video: it renders through a
              // texture/platform view, which is composited outside the layer
              // Flutter would clip — so the card had rounded corners and the
              // picture inside it had square ones.
              ClipRRect(
                borderRadius: BorderRadius.circular(_tileRadius),
                child: RTCVideoView(
                  _renderer,
                  mirror: widget.isSelf && !p.screenSharing,
                  objectFit: p.screenSharing
                      // A share centre-cropped reads as "stuck zoomed in".
                      ? RTCVideoViewObjectFit.RTCVideoViewObjectFitContain
                      : RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                ),
              ),
            if (!_ready || !_hasVideoTrack || !_live)
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
  const _Controls({
    required this.voice,
    required this.controller,
    this.compact = false,
    this.transparent = false,
    this.onEnterFullscreen,
  });

  final VoiceUiState voice;
  final VoiceController controller;

  /// Shows a fullscreen button when given. Absent in fullscreen itself, where
  /// the exit control lives on the overlay instead.
  final VoidCallback? onEnterFullscreen;

  /// Drop the labels and tighten the padding. Set on short viewports, where
  /// every row of chrome is height taken straight off the video.
  final bool compact;

  /// No solid background — the caller is floating this over video and supplies
  /// its own scrim.
  final bool transparent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(vertical: compact ? 2 : 10),
      color: transparent ? null : Palette.bgDark,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _CtlButton(
            icon: voice.muted ? Icons.mic_off : Icons.mic,
            label: voice.muted ? 'Unmute' : 'Mute',
            active: voice.muted,
            onTap: controller.toggleMute,
            showLabel: !compact,
          ),
          _CtlButton(
            icon: voice.deafened ? Icons.headset_off : Icons.headset,
            label: 'Deafen',
            active: voice.deafened,
            onTap: controller.toggleDeafen,
            showLabel: !compact,
          ),
          _CtlButton(
            icon: voice.cameraOn ? Icons.videocam : Icons.videocam_off,
            label: 'Camera',
            active: voice.cameraOn,
            onTap: controller.toggleCamera,
            showLabel: !compact,
          ),
          if (voice.cameraOn)
            _CtlButton(
              icon: Icons.cameraswitch,
              label: 'Flip',
              onTap: controller.switchCamera,
              showLabel: !compact,
            ),
          if (onEnterFullscreen != null)
            _CtlButton(
              icon: Icons.fullscreen,
              label: 'Fullscreen',
              onTap: onEnterFullscreen!,
              showLabel: !compact,
            ),
          _CtlButton(
            icon: Icons.call_end,
            label: 'Leave',
            danger: true,
            onTap: controller.leave,
            showLabel: !compact,
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
    this.showLabel = true,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final bool danger;
  final bool showLabel;

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
      // The label is what costs height; the tooltip keeps it discoverable once
      // it is gone, and the horizontal padding keeps the tap target honest.
      child: Tooltip(
        message: showLabel ? '' : label,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: 10,
            vertical: showLabel ? 6 : 8,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: color),
              if (showLabel) ...[
                const SizedBox(height: 3),
                Text(label, style: AppTextStyles.xs(color: Palette.inkDim)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// An icon button that stays legible on top of video, whatever the video
/// happens to be showing behind it.
class _ScrimIconButton extends StatelessWidget {
  const _ScrimIconButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black38,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(icon, size: 20, color: Colors.white),
        ),
      ),
    );
  }
}
