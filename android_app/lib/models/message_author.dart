/// The denormalized `author` snapshot embedded on every message doc.
/// Note: the UI re-resolves live name/photo/role from the current users
/// list where possible, falling back to this snapshot (see MessageList.jsx) —
/// this snapshot is never treated as the sole source of truth for rendering.
class MessageAuthor {
  final String uid;
  final String name;
  final String? photoURL;

  const MessageAuthor({required this.uid, required this.name, this.photoURL});

  static MessageAuthor fromMap(Map<String, dynamic>? data) {
    final d = data ?? {};
    return MessageAuthor(
      uid: (d['uid'] as String?) ?? '',
      name: (d['name'] as String?) ?? 'Unknown',
      photoURL: d['photoURL'] as String?,
    );
  }

  Map<String, dynamic> toMap() => {
    'uid': uid,
    'name': name,
    'photoURL': photoURL,
  };
}
