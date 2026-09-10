import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

/// Klipy GIF search/trending, port of `src/lib/gifs.js`.
///
/// Goes through the same standalone Worker the web uses, for the same reason:
/// the Klipy API key is a URL path segment, not a header, so it can never be
/// allowed near a client. This service holds no app data — Firestore remains
/// the backend for everything else.
///
/// Note the Worker's CORS allowlist (`ALLOWED_ORIGINS`) is irrelevant here.
/// It only decides whether to *echo* CORS response headers, and CORS is a
/// browser mechanism; a native client sends no Origin and is unaffected. Only
/// the `Authorization: Bearer <idToken>` check gates access, and that is
/// enforced for every caller alike.
abstract final class GifService {
  /// Override with `--dart-define=GIFS_WORKER_URL=...` to point at
  /// `wrangler dev` locally. Mirrors the web's VITE_GIFS_WORKER_URL, whose
  /// deployed value is this Worker.
  static const _workerUrl = String.fromEnvironment(
    'GIFS_WORKER_URL',
    defaultValue: 'https://punx-messenger-gifs.rey-433.workers.dev',
  );

  static Future<Map<String, dynamic>> _get(String path) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('Not signed in');
    final token = await user.getIdToken();

    final res = await http.get(
      Uri.parse('$_workerUrl$path'),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (res.statusCode != 200) {
      throw Exception('GIF request failed: ${res.statusCode} ${res.body}');
    }
    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    // The Worker wraps Klipy's payload once, and the web then reads `.data`
    // off that before handing it to the panel — so the list lives at
    // `data.data`. Keep both hops or the grid is silently always empty.
    return (decoded['data'] as Map<String, dynamic>?) ?? const {};
  }

  static Future<List<GifItem>> search(String query, {int page = 1}) async {
    final q = Uri.encodeQueryComponent(query);
    final data = await _get('/gifs/search?q=$q&page=$page');
    return _items(data);
  }

  static Future<List<GifItem>> trending({int page = 1}) async {
    final data = await _get('/gifs/trending?page=$page');
    return _items(data);
  }

  static List<GifItem> _items(Map<String, dynamic> data) {
    final raw = data['data'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(GifItem.fromJson)
        .where((g) => g.thumbUrl != null && g.sendUrl != null)
        .toList();
  }
}

/// One Klipy result, with the format choices the web makes in `gifs.js`.
class GifItem {
  const GifItem({required this.raw});

  factory GifItem.fromJson(Map<String, dynamic> json) => GifItem(raw: json);

  final Map<String, dynamic> raw;

  Map<String, dynamic>? _fmt(String size, String ext) {
    final file = raw['file'];
    if (file is! Map) return null;
    final bucket = file[size];
    if (bucket is! Map) return null;
    final f = bucket[ext];
    return f is Map<String, dynamic> ? f : null;
  }

  /// Grid thumbnail: `sm.webp`, falling back to `xs.webp` — the same
  /// quality/bandwidth trade the web makes.
  String? get thumbUrl =>
      (_fmt('sm', 'webp') ?? _fmt('xs', 'webp'))?['url'] as String?;

  Map<String, dynamic>? get _best =>
      _fmt('hd', 'webp') ??
      _fmt('md', 'webp') ??
      _fmt('hd', 'gif') ??
      _fmt('md', 'gif');

  String? get sendUrl => _best?['url'] as String?;

  String? get title => raw['title'] as String? ?? raw['slug'] as String?;

  /// Firestore rejects `undefined`, and the web is careful to send `null` for
  /// every absent field rather than omit it. Dart has no undefined, but the
  /// shape has to match the web's exactly so one client can render what the
  /// other sent.
  Map<String, dynamic> get sendMeta {
    final f = _best;
    return {
      'width': f?['width'],
      'height': f?['height'],
      'approxBytes': f?['size'],
      'originalName': title,
    };
  }
}
