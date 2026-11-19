// Spoilers: ||text|| hides text until it is pressed, as on Discord. Mirrors src/lib/spoilers.js.
//
// The message is stored as it was typed, so ||like this|| is what is in the database, and an older
// client simply shows the bars. It is a spoiler only when the bars touch the words on both sides:
// "a || b || c" (code, a table) and "||||" are not.
//
// Anywhere text is shown as plain text instead of drawn by the message renderer (the quote in a
// reply, a search result, the pinned list, a notification, the preview of a forward), hideSpoilers
// puts "[spoiler]" where the hidden text is, so it stays hidden there too.

/// One spoiler, as a piece of a regular expression (no groups): bars, a word character at each end,
/// no bar or line break inside.
const spoilerSource = r'\|\|[^|\s](?:[^|\n]*?[^|\s])?\|\|';

/// The words a spoiler is replaced by where it must not show.
const spoilerPlaceholder = '[spoiler]';

final _spoilerOnly = RegExp('^$spoilerSource\$');
final _spoilerEach = RegExp(spoilerSource);

/// Is this whole piece of text one spoiler?
bool isSpoiler(String s) => _spoilerOnly.hasMatch(s);

/// What is inside a spoiler: the text without its bars.
String spoilerInner(String s) => s.substring(2, s.length - 2);

/// [text] with every spoiler in it replaced by "[spoiler]", for the places that show plain text.
String hideSpoilers(String text) =>
    text.replaceAll(_spoilerEach, spoilerPlaceholder);
