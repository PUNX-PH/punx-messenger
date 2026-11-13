import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'gif_service.dart';

/// Asks the Worker (POST /onboarding/join-default-group,
/// workers/src/routes/onboarding.js) to add the signed-in person to the default
/// group (PUNX TEAM), with their own Firebase ID token, the way [TurnService]
/// and [GifService] reach it. Mirrors src/lib/onboardingApi.js.
///
/// A person cannot add themselves to a group, so the Worker does it, for the
/// caller only. This only asks; the Worker decides.
///
/// Never throws. The caller does not wait for it, and a missed attempt is
/// retried at the next sign-in for a week (see shouldJoinDefaultGroup), so a
/// failure here must never get in the way of signing in.
abstract final class DefaultGroupService {
  static Future<void> request() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;
      final res = await http.post(
        Uri.parse('${GifService.workerUrl}/onboarding/join-default-group'),
        headers: {'Authorization': 'Bearer ${await user.getIdToken()}'},
      );
      if (res.statusCode != 200) {
        debugPrint(
          '[onboarding] join-default-group answered ${res.statusCode}',
        );
      }
    } catch (e) {
      debugPrint('[onboarding] could not join the default group: $e');
    }
  }
}
