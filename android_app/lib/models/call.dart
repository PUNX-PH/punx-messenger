import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `/calls/{callId}` — see src/lib/calls.js and firestore.rules
/// `match /calls/{callId}` for the state machine this data drives.
class Call {
  final String id;
  final List<String> members; // exactly 2 uids, sorted
  final String callerUid;
  final String calleeUid;
  final String dmConvoId;
  final String pairKey;
  final String state; // ringing | accepted | declined | cancelled | missed | ended | failed
  final Map<String, dynamic>? offer; // { sdp, type }
  final Map<String, dynamic>? answer; // { sdp, type }
  final Timestamp? createdAt;
  final Timestamp? acceptedAt;
  final Timestamp? endedAt;
  final String? endedBy;

  const Call({
    required this.id,
    required this.members,
    required this.callerUid,
    required this.calleeUid,
    required this.dmConvoId,
    required this.pairKey,
    required this.state,
    this.offer,
    this.answer,
    this.createdAt,
    this.acceptedAt,
    this.endedAt,
    this.endedBy,
  });

  factory Call.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    return Call(
      id: doc.id,
      members: List<String>.from(data['members'] as List? ?? const []),
      callerUid: data['callerUid'] as String? ?? '',
      calleeUid: data['calleeUid'] as String? ?? '',
      dmConvoId: data['dmConvoId'] as String? ?? '',
      pairKey: data['pairKey'] as String? ?? '',
      state: data['state'] as String? ?? 'ended',
      offer: data['offer'] as Map<String, dynamic>?,
      answer: data['answer'] as Map<String, dynamic>?,
      createdAt: data['createdAt'] as Timestamp?,
      acceptedAt: data['acceptedAt'] as Timestamp?,
      endedAt: data['endedAt'] as Timestamp?,
      endedBy: data['endedBy'] as String?,
    );
  }

  String otherUid(String myUid) => callerUid == myUid ? calleeUid : callerUid;

  static const activeStates = ['ringing', 'accepted'];
  static const terminalStates = [
    'declined',
    'cancelled',
    'missed',
    'ended',
    'failed',
  ];
}

/// One entry in `calls/{callId}/candidates`.
class CallCandidate {
  final String id;
  final String from;
  final Map<String, dynamic> candidate; // { candidate, sdpMid, sdpMLineIndex }

  const CallCandidate({
    required this.id,
    required this.from,
    required this.candidate,
  });

  factory CallCandidate.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    return CallCandidate(
      id: doc.id,
      from: data['from'] as String? ?? '',
      candidate: Map<String, dynamic>.from(
        data['candidate'] as Map? ?? const {},
      ),
    );
  }
}
