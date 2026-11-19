import 'dart:typed_data';

// Several pictures in one go: which are accepted, and sending them one after another. Mirrors
// src/lib/attachments.js.
//
// A picture is stored inside its message (there is no file storage), and a message document can
// hold about 1 MB, so two pictures cannot share one. Each picture is therefore its own message, in
// the order they were chosen. What was typed goes with the first, and a reply quote with the first
// (the chat controller clears "replying to" once a message has gone, so the rest do not repeat it).

/// At most this many pictures wait to be sent at once.
const maxAttachments = 10;

/// Each picture may be this big (before it is shrunk for sending).
const maxAttachmentBytes = 10 * 1024 * 1024;

/// A picture chosen and waiting to be sent.
class Attachment {
  const Attachment({required this.bytes, required this.name});
  final Uint8List bytes;
  final String name;

  int get size => bytes.lengthInBytes;

  /// The same picture chosen twice is one attachment. (A file's name and size; the phone's picker
  /// does not say when it was last changed, which the web adds.)
  bool sameAs(Attachment other) => name == other.name && size == other.size;
}

String _plural(int n, String one, String many) => '$n ${n == 1 ? one : many}';

/// Adds [incoming] to the pictures already waiting. Returns the new list and one sentence about
/// whatever was left out (null when nothing was). Order is kept (what was there, then what came in),
/// and nothing already there is ever dropped. A picture that is too big, or one too many, never
/// takes a place.
({List<Attachment> files, String? problem}) addAttachments(
  List<Attachment> current,
  Iterable<Attachment> incoming,
) {
  final files = [...current];
  var tooBig = 0;
  var tooMany = 0;
  for (final f in incoming) {
    if (f.size > maxAttachmentBytes) {
      tooBig++;
      continue;
    }
    if (files.any(f.sameAs)) continue;
    if (files.length >= maxAttachments) {
      tooMany++;
      continue;
    }
    files.add(f);
  }
  final parts = <String>[
    if (tooBig > 0) '${_plural(tooBig, 'image is', 'images are')} over 10 MB',
    if (tooMany > 0)
      '${_plural(tooMany, 'image', 'images')} left out: at most $maxAttachments at a time',
  ];
  return (files: files, problem: parts.isEmpty ? null : '${parts.join('; ')}.');
}

/// Sends one message: [file] is null for a message of words only.
typedef AttachmentSend = Future<void> Function({required String text, Attachment? file});

/// Sends what is waiting.
///  - nothing attached: one message with the text;
///  - pictures: one message each, in order; the text rides on the first.
/// Stops at the first failure and says how far it got, so the rest can be kept for another try:
/// `sent` is the number of messages that went, `error` is null when all did.
/// [onProgress] is called with (done, total) before each message goes.
Future<({int sent, Object? error})> sendAttachments({
  required String text,
  required List<Attachment> files,
  required AttachmentSend send,
  void Function(int done, int total)? onProgress,
}) async {
  if (files.isEmpty) {
    try {
      await send(text: text, file: null);
    } catch (error) {
      return (sent: 0, error: error);
    }
    return (sent: 1, error: null);
  }
  for (var i = 0; i < files.length; i++) {
    onProgress?.call(i, files.length);
    try {
      await send(text: i == 0 ? text : '', file: files[i]);
    } catch (error) {
      return (sent: i, error: error);
    }
  }
  return (sent: files.length, error: null);
}

/// What is left to send after [sent] pictures went: the rest, in order.
List<Attachment> remainingAfter(List<Attachment> files, int sent) =>
    files.skip(sent < 0 ? 0 : sent).toList();

/// The box's hint while sending: "Uploading…" for one, "Uploading 2 of 5…" for several.
String uploadingText(int done, int total) =>
    total > 1 ? 'Uploading ${done + 1 > total ? total : done + 1} of $total…' : 'Uploading…';
