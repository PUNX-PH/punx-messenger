import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';

/// Mirrors `invites/{token}` — see src/lib/invites.js, which owns the shape.
///
/// The document id IS the secret: the link is `/invite/<token>`, and anyone
/// holding it can join the channels it names until it expires or is revoked.
/// That is why only a group's admins may list these (firestore.rules), and why
/// the token is never shown anywhere but inside the full link.
class GroupInvite {
  const GroupInvite({
    required this.token,
    required this.groupId,
    this.groupName = '',
    this.channelIds = const [],
    this.channelNames = const [],
    this.createdBy,
    this.createdAt,
    this.expiresAt,
    this.revoked = false,
  });

  final String token;
  final String groupId;

  /// Denormalised onto the invite, because the person opening the link can read
  /// this one document and nothing else — not even the group's name.
  final String groupName;
  final List<String> channelIds;
  final List<String> channelNames;
  final String? createdBy;
  final Timestamp? createdAt;
  final Timestamp? expiresAt;
  final bool revoked;

  /// Tolerant, like every parser here: a wrong-typed field degrades instead of
  /// throwing inside the snapshot stream and emptying the whole list.
  factory GroupInvite.fromMap(String token, Map<String, dynamic> data) {
    List<String> strings(Object? v) =>
        v is List ? v.whereType<String>().toList() : const [];
    return GroupInvite(
      token: token,
      groupId: data['groupId'] is String ? data['groupId'] as String : '',
      groupName: data['groupName'] is String ? data['groupName'] as String : '',
      channelIds: strings(data['channelIds']),
      channelNames: strings(data['channelNames']),
      createdBy: data['createdBy'] is String
          ? data['createdBy'] as String
          : null,
      createdAt: data['createdAt'] is Timestamp
          ? data['createdAt'] as Timestamp
          : null,
      expiresAt: data['expiresAt'] is Timestamp
          ? data['expiresAt'] as Timestamp
          : null,
      revoked: data['revoked'] == true,
    );
  }

  factory GroupInvite.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) =>
      GroupInvite.fromMap(doc.id, doc.data() ?? const {});

  bool isExpired({DateTime? now}) {
    final at = expiresAt?.toDate();
    // No readable expiry means we cannot promise the link still works.
    return at == null || !at.isAfter(now ?? DateTime.now());
  }

  /// Same test as `inviteIsLive` on the web: not revoked and not expired.
  bool isLive({DateTime? now}) => !revoked && !isExpired(now: now);

  /// 'revoked' wins over 'expired': it is the one a person did on purpose.
  String? statusLabel({DateTime? now}) {
    if (revoked) return 'Revoked';
    if (isExpired(now: now)) return 'Expired';
    return null;
  }

  /// "Expires Oct 22" / "Expired Oct 8"; empty when there is no expiry.
  String expiryLabel({DateTime? now}) {
    final at = expiresAt?.toDate();
    if (at == null) return '';
    final when = DateFormat.MMMd().format(at);
    return at.isAfter(now ?? DateTime.now())
        ? 'Expires $when'
        : 'Expired $when';
  }
}

/// How long a new link lasts. Same choices as DAY_OPTIONS on the web.
const inviteDayOptions = <({int days, String label})>[
  (days: 1, label: '1 day'),
  (days: 7, label: '7 days'),
  (days: 30, label: '30 days'),
];
