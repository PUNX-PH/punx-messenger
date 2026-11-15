import '../models/message.dart';
import '../models/user_profile.dart';

// "Copy text" on a message: mirrors src/lib/copyText.js, so the two apps copy the same thing.
//
// What is copied is what the person would paste into a message of their own: the text as it was
// written (so **bold** and `code` still work when pasted back), but with mentions turned back into
// the names people see, not the internal <@uid> tokens they are stored as.

final RegExp _mention = RegExp(r'<@([A-Za-z0-9_-]{6,40})>');

/// Shown in place of a mention whose person is not in the directory (left the workspace, not
/// loaded yet): what the message itself shows for it.
const String unknownMention = '@Unknown';

/// Does this message have text that can be copied? A picture or a voice message on its own does not.
bool hasCopyableText(ChatMessage message) => message.text.trim().isNotEmpty;

/// The text to put on the clipboard for a message: its text with each mention written as @Name.
/// '' when there is none.
String copyableText(ChatMessage message, Map<String, UserProfile> usersById) {
  return message.text
      .replaceAllMapped(_mention, (m) {
        final name = usersById[m.group(1)]?.name.trim() ?? '';
        return name.isNotEmpty ? '@$name' : unknownMention;
      })
      .trim();
}
