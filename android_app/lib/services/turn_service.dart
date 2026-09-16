import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import 'gif_service.dart';

/// Short-lived TURN credentials, fetched from the Worker — port of
/// `resolveIceServers` in `src/lib/webrtc.js`.
///
/// They cannot be compiled in like the STUN list: the key that issues them
/// must stay server-side, and what it issues expires. The Worker mints one per
/// signed-in user against the Firebase ID token this client already holds,
/// exactly as [GifService] does.
///
/// Without TURN, a pair that cannot reach each other directly has nothing to
/// relay through and the connection simply fails — silently, per pair, working
/// for some people and not others.
abstract final class TurnService {
  /// Cached for the process: credentials outlive any realistic call, and a
  /// channel of six should mint one credential, not six.
  static Future<List<Map<String, dynamic>>>? _pending;

  /// ICE servers to build connections with: STUN plus TURN when the Worker can
  /// mint it, STUN alone when it cannot.
  ///
  /// Never throws. No TURN means hard-to-reach pairs fail to connect — where
  /// this app already was — whereas failing here would break voice for
  /// everybody, including the majority who never need a relay.
  static Future<List<Map<String, dynamic>>> iceServers() {
    return _pending ??= _fetch().catchError((Object e) {
      debugPrint('[turn] no TURN available, falling back to STUN-only: $e');
      _pending = null; // let a later join try again
      return AppConfig.iceServers
          .map((s) => Map<String, dynamic>.from(s))
          .toList();
    });
  }

  static Future<List<Map<String, dynamic>>> _fetch() async {
    final base = AppConfig.iceServers
        .map((s) => Map<String, dynamic>.from(s))
        .toList();

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return base;

    final res = await http.get(
      Uri.parse('${GifService.workerUrl}/turn/credentials'),
      headers: {'Authorization': 'Bearer ${await user.getIdToken()}'},
    );
    if (res.statusCode != 200) {
      throw Exception('TURN request failed: ${res.statusCode}');
    }

    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    final list = (decoded['iceServers'] as List?)
        ?.whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    if (list == null || list.isEmpty) throw Exception('TURN returned nothing');

    // Keep STUN alongside: a direct path is always preferable to a relayed
    // one, and ICE picks the relay only when it has to.
    return [...base, ...list];
  }
}
