import 'package:firebase_core/firebase_core.dart';

/// Which step of opening a direct message failed.
///
/// Opening one is three separate Firestore calls (read the other person's profile,
/// look for the conversation, create it if it is not there), and any of them can be
/// refused for a different reason. The raw error text names none of them, so a
/// screenshot of "permission-denied" could not say what was actually wrong.
enum DmOpenStep { readProfile, checkConversation, createConversation }

/// An error opening a direct message, with the step that raised it.
class DmOpenException implements Exception {
  const DmOpenException({
    required this.step,
    required this.cause,
    this.convoId,
  });

  final DmOpenStep step;
  final Object cause;

  /// The conversation's document id (`<uid>__<uid>`, sorted), once it is known.
  final String? convoId;

  String? get code =>
      cause is FirebaseException ? (cause as FirebaseException).code : null;

  @override
  String toString() => 'DmOpenException(${step.name}, $code, $cause)';
}

/// What to tell the person, and what to tell whoever they report it to.
class DmOpenProblem {
  const DmOpenProblem({required this.message, required this.details});

  /// Plain words: what happened and what to do about it.
  final String message;

  /// One short technical line, safe to read out or screenshot.
  final String details;
}

/// Turns whatever went wrong into words. Pure, so it is tested.
DmOpenProblem describeDmOpenError(Object error) {
  if (error is! DmOpenException) {
    // Not one of the three steps (for instance "That teammate doesn't exist").
    final text = '$error';
    return DmOpenProblem(
      message: text.startsWith('Bad state: ') ? text.substring(11) : text,
      details: '',
    );
  }

  final code = error.code;
  final details = [
    'Step: ${_stepLabel(error.step)}',
    if (code != null) 'Code: $code',
    if (error.convoId != null) 'Conversation: ${error.convoId}',
  ].join(' · ');

  if (code == 'unavailable' || code == 'deadline-exceeded') {
    return DmOpenProblem(
      message:
          "Couldn't reach the server. Check your connection and try again.",
      details: details,
    );
  }

  if (code == 'permission-denied') {
    final message = switch (error.step) {
      DmOpenStep.readProfile =>
        "Couldn't open this person's profile. If your access to the workspace "
            'changed recently, sign out and back in; otherwise ask an admin to '
            'check your access.',
      DmOpenStep.checkConversation =>
        'A conversation between the two of you already exists, but it does not '
            'list you as one of its members, so the server will not let you open '
            'it. An admin needs to fix or remove it (the id is below).',
      DmOpenStep.createConversation =>
        'The server refused to start this conversation. Ask an admin to check '
            'your access.',
    };
    return DmOpenProblem(message: message, details: details);
  }

  return DmOpenProblem(
    message: "Couldn't open this conversation.",
    details: details,
  );
}

String _stepLabel(DmOpenStep step) => switch (step) {
  DmOpenStep.readProfile => "reading the other person's profile",
  DmOpenStep.checkConversation => 'looking for the conversation',
  DmOpenStep.createConversation => 'creating the conversation',
};
