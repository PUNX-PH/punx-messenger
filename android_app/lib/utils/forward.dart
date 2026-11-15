import '../models/custom_status.dart' show cleanStatusText;
import '../models/forwarded_from.dart';
import '../models/image_meta.dart';
import '../models/message.dart';
import '../models/user_profile.dart';
import '../models/voice_clip.dart';
import 'copy_text.dart';

// The copy a forward or a saved message carries: mirrors src/lib/forward.js, so the two apps copy
// the same thing.
//
// A forward is a NEW message from the person forwarding, carrying a copy of the text and the
// picture or voice message, and a small `forwardedFrom: { uid, name }` so it can say who wrote it
// first. Nothing else of the original comes along: not its reactions, its pin, its replies, or
// where it was (a message from a private channel must not name that channel to people who are not
// in it).
//
// Mentions are written out as @Name rather than copied as <@uid> tokens: a copy must not ping the
// people mentioned in it, or tint the row as a mention for them.

/// Does this message have something to copy on? Text, a picture or a voice message.
bool canForward(ChatMessage message) =>
    hasCopyableText(message) ||
    (message.imageURL != null && message.imageURL!.isNotEmpty) ||
    message.voice != null;

/// What to store for the copy of [message].
class ForwardPayload {
  const ForwardPayload({
    required this.text,
    required this.forwardedFrom,
    this.imageURL,
    this.imageMeta,
    this.voice,
  });

  final String text;
  final String? imageURL;
  final ImageMeta? imageMeta;

  /// The voice message, with the type it was recorded as when that is known.
  final VoiceClip? voice;
  final ForwardedFrom forwardedFrom;
}

/// What to send when forwarding (or saving) [message]. [usersById] turns mentions into names. A
/// message that was itself forwarded keeps its ORIGINAL writer, not the person who passed it on.
/// Null when there is nothing to forward.
ForwardPayload? forwardPayload(
  ChatMessage message,
  Map<String, UserProfile> usersById,
) {
  if (!canForward(message)) return null;
  final authorName = usersById[message.author.uid]?.name ?? '';
  final liveName = authorName.isNotEmpty ? authorName : message.author.name;
  final cleaned = cleanStatusText(liveName);
  final from =
      message.forwardedFrom ??
      ForwardedFrom(
        uid: message.author.uid,
        name: cleaned.isEmpty ? 'Unknown' : cleaned,
      );
  final hasImage = message.imageURL != null && message.imageURL!.isNotEmpty;
  return ForwardPayload(
    text: copyableText(message, usersById),
    imageURL: hasImage ? message.imageURL : null,
    imageMeta: hasImage ? message.imageMeta : null,
    voice: message.voice,
    forwardedFrom: from,
  );
}
