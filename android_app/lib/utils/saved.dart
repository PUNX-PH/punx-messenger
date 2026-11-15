import '../models/message.dart';
import '../models/user_profile.dart';
import 'forward.dart';

// Saved messages: a bookmark that keeps a copy of a message in your private notes, with who wrote
// it and, for a channel message, a way back to the original. Mirrors src/lib/saved.js.
//
// "My Notes" is already a private place only you can read (firestore.rules: users/{uid}/notes), so
// a saved message is a note, and the list of saved messages is My Notes. Nothing new is stored
// anywhere public, and nothing in the rules had to change.
//
// The note's id comes from the message's id, so saving the same message twice is one note, not
// two: the second time just says it is already there.

/// How a try at saving ended.
enum SaveResult { saved, exists, failed }

final RegExp _id = RegExp(r'^[A-Za-z0-9_-]{1,64}$');
final RegExp _channelMessages = RegExp(
  r'^groups/([A-Za-z0-9_-]{1,64})/channels/([A-Za-z0-9_-]{1,64})/messages$',
);

/// The id of the note that holds a saved message, or null for a message with no usable id.
String? savedNoteId(String messageId) =>
    _id.hasMatch(messageId) ? 's_$messageId' : null;

/// Where to go to see the original, as the WEB writes it (`/g/<group>/c/<channel>?m=<message>`, so
/// the web can follow it from a note saved on a phone): for a message in a channel, null for
/// anything else (a DM has no address that means the same to both people).
String? originalRoute(String path, String messageId) {
  final m = _channelMessages.firstMatch(path);
  if (m == null || !_id.hasMatch(messageId)) return null;
  return '/g/${m.group(1)}/c/${m.group(2)}?m=$messageId';
}

/// What to store for a saved message: the same copy a forward makes plus where it was saved from.
class SavedPayload {
  const SavedPayload({required this.copy, required this.route});

  final ForwardPayload copy;
  final String? route;
}

/// What to store for [message], found in the messages collection at [path]. Null when there is
/// nothing to save.
SavedPayload? savedPayload(
  ChatMessage message,
  Map<String, UserProfile> usersById,
  String path,
) {
  final copy = forwardPayload(message, usersById);
  if (copy == null) return null;
  return SavedPayload(copy: copy, route: originalRoute(path, message.id));
}
