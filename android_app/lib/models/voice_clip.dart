import 'dart:convert';
import 'dart:typed_data';

/// A voice message on a chat message: the same two fields the web app writes
/// (`audioURL`, `audioMeta.durationMs`; see voiceMessage.js, which this mirrors).
///
/// The recording is stored inside the message as a base64 `data:` address, like
/// pictures, because there is no file storage. Only that exact shape is ever
/// played: a message from someone else must not be able to make this phone fetch
/// anything from anywhere, so a web address, a `blob:` address, a non-audio type
/// or anything not base64 is not a voice message and is ignored.
const int maxVoiceMs = 60 * 1000;

/// The most characters an address may have (a message document must stay under
/// 1 MiB, and a voice message is only part of it).
const int maxVoiceChars = 700000;

/// The shortest recording that is sent (a slip of the finger is not a message).
const int minVoiceMs = 700;

final RegExp _audioUrl = RegExp(
  r'^data:audio/(webm|ogg|mp4|mpeg|aac|wav|x-m4a)(;codecs=[A-Za-z0-9.,+-]+)?;base64,[A-Za-z0-9+/]+={0,2}$',
);

/// Is [url] an address a voice message may play from?
bool isPlayableAudioUrl(Object? url) =>
    url is String && url.length <= maxVoiceChars && _audioUrl.hasMatch(url);

class VoiceClip {
  const VoiceClip({
    required this.dataUrl,
    required this.durationMs,
    this.storedMime,
  });

  final String dataUrl;

  /// How long it is, as stored with the message; 0 when it was not stored (the
  /// player then reads the length from the file itself).
  final int durationMs;

  /// The type the web wrote with the message (`audioMeta.mime`), when it did. Kept so a copy of
  /// the message can carry it on; the type that is PLAYED comes from the address ([mime]).
  final String? storedMime;

  /// Reads a message's fields. Null when it has no voice message, or one that
  /// must not be played.
  static VoiceClip? fromFields(Object? audioUrl, Object? audioMeta) {
    if (!isPlayableAudioUrl(audioUrl)) return null;
    var ms = 0;
    if (audioMeta is Map) {
      final d = audioMeta['durationMs'];
      if (d is num && d.isFinite && d > 0) {
        ms = d.round() > maxVoiceMs ? maxVoiceMs : d.round();
      }
    }
    final mime = audioMeta is Map ? audioMeta['mime'] : null;
    return VoiceClip(
      dataUrl: audioUrl as String,
      durationMs: ms,
      storedMime: mime is String ? mime : null,
    );
  }

  /// `audio/mp4`, `audio/webm`... from the address.
  String get mime {
    final end = dataUrl.indexOf(';');
    return dataUrl.substring('data:'.length, end);
  }

  /// The recording itself.
  Uint8List get bytes =>
      base64Decode(dataUrl.substring(dataUrl.indexOf(',') + 1));

  /// Can an iPhone play it? Its player cannot read WebM or Ogg (what Chrome and
  /// Firefox record); MP4/AAC, which Safari records and the web app now prefers,
  /// plays everywhere.
  bool get playsOnIPhone => mime != 'audio/webm' && mime != 'audio/ogg';
}

/// `0:07`, `1:05`: minutes and seconds, to the nearest second.
String formatVoiceDuration(num ms) {
  final seconds = ms.isFinite && ms > 0 ? (ms / 1000).round() : 0;
  return '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
}
