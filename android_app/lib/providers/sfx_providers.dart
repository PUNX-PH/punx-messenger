import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/sfx_service.dart';

final sfxServiceProvider = Provider<SfxService>(
  (ref) => SfxService(AudioplayersBackend()),
);

/// Whether sound effects are on, remembered across launches.
///
/// Per device, like the theme and for the same reason: it is a property of the
/// phone in your hand (silent in a meeting, on at home), not of the account.
/// On by default.
class SfxEnabledController extends StateNotifier<bool> {
  SfxEnabledController(this._service) : super(true) {
    _load();
  }

  final SfxService _service;
  static const _key = 'sfxEnabled';

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getBool(_key);
      if (saved != null) _apply(saved);
    } catch (_) {
      // A preferences failure must not stop the app opening; sound stays on.
    }
  }

  Future<void> setEnabled(bool on) async {
    _apply(on);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_key, on);
    } catch (_) {
      // The choice still applies for this session.
    }
    // Turning it ON plays a ping, so you can tell it works.
    if (on) _service.play(Sfx.dmPing);
  }

  void _apply(bool on) {
    _service.setEnabled(on);
    state = on;
  }
}

final sfxEnabledProvider = StateNotifierProvider<SfxEnabledController, bool>(
  (ref) => SfxEnabledController(ref.watch(sfxServiceProvider)),
);
