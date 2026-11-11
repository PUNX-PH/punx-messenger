import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Unsent message text, kept per conversation, so leaving a chat (back button, or
/// iOS reclaiming the app in the background) does not throw away what was typed.
///
/// Same rules as the web app's drafts (src/lib/drafts.js): the 50 most recently
/// touched drafts are kept, each at most [maxChars] long; an empty or whitespace-only
/// draft is no draft; and they are written to storage after a pause in typing and
/// whenever the app goes to the background. Keys carry the account as well as the
/// conversation, and everything is wiped on sign-out so the next person on a shared
/// phone does not see them.
///
/// Storage is passed in (and may be absent) so it can be tested.
class DraftStore with WidgetsBindingObserver {
  DraftStore(
    this._prefs, {
    this.saveDelay = const Duration(milliseconds: 400),
    bool observeLifecycle = false,
  }) {
    _drafts = _load();
    if (observeLifecycle) WidgetsBinding.instance.addObserver(this);
  }

  /// Loads the saved drafts. Used once at start-up, before anything is drawn, so a
  /// chat opened at once (from a notification, say) already finds its draft.
  static Future<DraftStore> load() async =>
      DraftStore(await SharedPreferences.getInstance(), observeLifecycle: true);

  /// Keeps drafts for this run only. For tests and as a safe default.
  factory DraftStore.inMemory() => DraftStore(null, saveDelay: Duration.zero);

  static const _storageKey = 'punx.drafts';
  static const maxDrafts = 50;
  static const maxChars = 20000;

  final SharedPreferences? _prefs;
  final Duration saveDelay;
  late Map<String, String> _drafts; // insertion order = how recently touched
  Timer? _timer;

  Map<String, String> _load() {
    final out = <String, String>{};
    try {
      final raw = _prefs?.getString(_storageKey);
      if (raw == null) return out;
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        for (final e in decoded.entries) {
          final v = e.value;
          if (e.key is String && v is String && v.trim().isNotEmpty) {
            out[e.key as String] = v;
          }
        }
      }
    } catch (_) {
      // Damaged storage: start empty rather than stop the app opening.
    }
    return out;
  }

  /// The saved text for a conversation, or '' if there is none.
  String get(String? key) => key == null ? '' : (_drafts[key] ?? '');

  /// Saves what is in the box now. Empty (or only spaces) means no draft.
  void set(String? key, String text) {
    if (key == null) return;
    if (text.trim().isEmpty) {
      clear(key);
      return;
    }
    _drafts.remove(key); // re-inserting makes it the newest
    _drafts[key] = text.length > maxChars ? text.substring(0, maxChars) : text;
    while (_drafts.length > maxDrafts) {
      _drafts.remove(_drafts.keys.first);
    }
    _scheduleSave();
  }

  void clear(String? key) {
    if (key != null && _drafts.remove(key) != null) _scheduleSave();
  }

  /// Everything: for signing out. Written through at once.
  Future<void> clearAll() async {
    _drafts = {};
    await flush();
  }

  void _scheduleSave() {
    if (saveDelay == Duration.zero) {
      unawaited(flush());
      return;
    }
    _timer?.cancel();
    _timer = Timer(saveDelay, () => unawaited(flush()));
  }

  /// Writes to storage now (the app is going to the background, or a test).
  Future<void> flush() async {
    _timer?.cancel();
    _timer = null;
    try {
      if (_drafts.isEmpty) {
        await _prefs?.remove(_storageKey);
      } else {
        await _prefs?.setString(_storageKey, jsonEncode(_drafts));
      }
    } catch (_) {
      // Storage full or blocked: drafts still work for this run.
    }
  }

  // The app being backgrounded may be the last chance to save before iOS or
  // Android ends the process.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) unawaited(flush());
  }

  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
  }
}
