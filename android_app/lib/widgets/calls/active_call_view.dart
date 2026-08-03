import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../providers/auth_providers.dart';
import '../../providers/calls_providers.dart';
import '../../providers/users_providers.dart';
import '../../theme/palette.dart';
import '../shared/avatar.dart';

/// Outgoing-ringing card or connected video tiles + controls. Rendered by
/// CallOverlay for CallStatus.outgoing / CallStatus.connected.
class ActiveCallView extends ConsumerStatefulWidget {
  const ActiveCallView({super.key});

  @override
  ConsumerState<ActiveCallView> createState() => _ActiveCallViewState();
}

class _ActiveCallViewState extends ConsumerState<ActiveCallView> {
  final _localRenderer = RTCVideoRenderer();
  final _remoteRenderer = RTCVideoRenderer();
  bool _renderersReady = false;

  @override
  void initState() {
    super.initState();
    _initRenderers();
  }

  Future<void> _initRenderers() async {
    await _localRenderer.initialize();
    await _remoteRenderer.initialize();
    if (mounted) setState(() => _renderersReady = true);
  }

  @override
  void dispose() {
    _localRenderer.dispose();
    _remoteRenderer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final callState = ref.watch(callControllerProvider);
    final controller = ref.read(callControllerProvider.notifier);
    final myUid = ref.watch(authStateProvider).valueOrNull?.uid;
    final call = callState.call;
    if (call == null || myUid == null) return const SizedBox.shrink();

    if (_renderersReady) {
      _localRenderer.srcObject = callState.localStream;
      _remoteRenderer.srcObject = callState.remoteStream;
    }

    final connected = callState.status == CallStatus.connected;
    final isVideoCall = call.type == 'video';
    final showRemoteVideo = isVideoCall && connected;
    final other = ref.watch(usersByIdProvider)[call.otherUid(myUid)];

    return Material(
      color: Colors.black.withValues(alpha: 0.95),
      child: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(
                    child: showRemoteVideo && _renderersReady
                        ? RTCVideoView(
                            _remoteRenderer,
                            objectFit:
                                RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
                          )
                        : Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Avatar(
                                  name: other?.name ?? '?',
                                  src: other?.photoURL,
                                  size: 96,
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  other?.name ?? 'Calling…',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 18,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  connected ? 'Voice call connected' : 'Ringing…',
                                  style: const TextStyle(color: Colors.white60),
                                ),
                              ],
                            ),
                          ),
                  ),
                  if (isVideoCall && _renderersReady)
                    Positioned(
                      right: 16,
                      bottom: 16,
                      width: 120,
                      height: 160,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          color: Colors.black,
                          child: RTCVideoView(
                            _localRenderer,
                            mirror: true,
                            objectFit:
                                RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                          ),
                        ),
                      ),
                    ),
                  if (callState.connError != null)
                    Positioned(
                      top: 16,
                      left: 24,
                      right: 24,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          color: Palette.bad.withValues(alpha: 0.9),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          callState.connError!,
                          style: const TextStyle(color: Colors.white),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Container(
              height: 88,
              color: Colors.black45,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _ControlButton(
                    icon: callState.muted ? Icons.mic_off : Icons.mic,
                    active: callState.muted,
                    onPressed: controller.toggleMute,
                  ),
                  if (isVideoCall) ...[
                    const SizedBox(width: 20),
                    _ControlButton(
                      icon: callState.cameraOff
                          ? Icons.videocam_off
                          : Icons.videocam,
                      active: callState.cameraOff,
                      onPressed: controller.toggleCamera,
                    ),
                  ],
                  const SizedBox(width: 20),
                  _ControlButton(
                    icon: Icons.call_end,
                    danger: true,
                    onPressed: controller.endActiveCall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({
    required this.icon,
    required this.onPressed,
    this.active = false,
    this.danger = false,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final bool active;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final bg = danger
        ? Palette.bad
        : active
        ? Colors.white
        : Colors.white.withValues(alpha: 0.15);
    final fg = danger
        ? Colors.white
        : active
        ? Colors.black
        : Colors.white;
    return Material(
      color: bg,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Icon(icon, color: fg, size: 24),
        ),
      ),
    );
  }
}
