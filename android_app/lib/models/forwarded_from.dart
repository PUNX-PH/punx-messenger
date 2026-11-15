import 'custom_status.dart' show cleanStatusText;

/// Who a forwarded or saved message first came from, as stored on it:
/// `forwardedFrom: { uid, name }` (see src/lib/forward.js, which this mirrors).
class ForwardedFrom {
  const ForwardedFrom({required this.name, this.uid});

  final String name;
  final String? uid;

  /// Reads what a message holds. Null when it is not a forward or what is stored is not usable.
  /// Safe to call on anybody's message: the name is cleaned again here (any member can write
  /// anything into a message): one line, at most 60 characters.
  static ForwardedFrom? parse(Object? raw) {
    if (raw is! Map) return null;
    final name = cleanStatusText(raw['name']);
    if (name.isEmpty) return null;
    final uid = raw['uid'];
    return ForwardedFrom(name: name, uid: uid is String ? uid : null);
  }

  Map<String, Object?> toMap() => {'uid': uid, 'name': name};
}
