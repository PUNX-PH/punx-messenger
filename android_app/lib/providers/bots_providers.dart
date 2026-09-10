import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/bot_service.dart';

final botServiceProvider = Provider<BotService>(
  (ref) => BotService(FirebaseFirestore.instance),
);

/// The bot registry. Admin-only by the rules, so this is only ever watched
/// from behind the admin panel's own gate.
final botsStreamProvider = StreamProvider<List<Bot>>(
  (ref) => ref.watch(botServiceProvider).listenBots(),
);
