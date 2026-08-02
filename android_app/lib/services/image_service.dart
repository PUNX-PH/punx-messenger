import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// Thrown when an image can't be decoded or stays over budget after
/// compression — mirrors the errors thrown by images.js.
class ImageProcessingException implements Exception {
  final String message;
  const ImageProcessingException(this.message);
  @override
  String toString() => message;
}

class ImagePreset {
  final int maxSide;
  final double quality; // 0..1, JPEG only — ignored for PNG
  final String mime; // 'image/jpeg' | 'image/png'
  const ImagePreset({
    required this.maxSide,
    required this.quality,
    required this.mime,
  });
}

/// 1:1 port of images.js's PRESETS.
abstract final class ImagePresets {
  static const messageImage = ImagePreset(
    maxSide: 1280,
    quality: 0.82,
    mime: 'image/jpeg',
  );
  static const avatar = ImagePreset(
    maxSide: 256,
    quality: 0.9,
    mime: 'image/jpeg',
  );
  static const banner = ImagePreset(
    maxSide: 1500,
    quality: 0.85,
    mime: 'image/jpeg',
  );
  static const emoji = ImagePreset(
    maxSide: 128,
    quality: 0.95,
    mime: 'image/png',
  ); // preserve transparency
}

class ResizedImage {
  final String dataUrl;
  final int width;
  final int height;
  final int approxBytes;
  const ResizedImage({
    required this.dataUrl,
    required this.width,
    required this.height,
    required this.approxBytes,
  });
}

/// Client-side image processing — no Firebase Storage. Resizes + compresses
/// image bytes and returns a data URL embeddable directly in a Firestore
/// document, matching src/lib/images.js exactly (including the budget and
/// the quality-stepdown retry loop) so both clients stay interoperable.
abstract final class ImageService {
  // Firestore doc limit is 1MB; base64 inflates ~33%, so stay well under that.
  static const _maxEncodedBytes = 900 * 1024;

  static Future<ResizedImage> resizeToDataUrl(
    Uint8List bytes,
    ImagePreset preset,
  ) async {
    img.Image? decoded;
    try {
      decoded = img.decodeImage(bytes);
    } catch (_) {
      // Malformed input can make a format decoder throw mid-probe instead of
      // returning null — treat that the same as "not an image".
      decoded = null;
    }
    if (decoded == null) {
      throw const ImageProcessingException('Not an image file.');
    }

    final scale = math.min(
      1.0,
      preset.maxSide / math.max(decoded.width, decoded.height),
    );
    final w = math.max(1, (decoded.width * scale).round());
    final h = math.max(1, (decoded.height * scale).round());
    final resized = scale < 1.0
        ? img.copyResize(
            decoded,
            width: w,
            height: h,
            interpolation: img.Interpolation.cubic,
          )
        : decoded;

    Uint8List encoded;
    String base64Str;

    if (preset.mime == 'image/png') {
      encoded = Uint8List.fromList(img.encodePng(resized));
      base64Str = base64Encode(encoded);
    } else {
      var quality = preset.quality;
      encoded = Uint8List.fromList(
        img.encodeJpg(resized, quality: _toJpegQuality(quality)),
      );
      base64Str = base64Encode(encoded);
      while (base64Str.length > _maxEncodedBytes && quality > 0.4) {
        quality -= 0.12;
        encoded = Uint8List.fromList(
          img.encodeJpg(resized, quality: _toJpegQuality(quality)),
        );
        base64Str = base64Encode(encoded);
      }
    }

    if (base64Str.length > _maxEncodedBytes) {
      throw const ImageProcessingException(
        'Image too large even after compression — try a smaller image.',
      );
    }

    return ResizedImage(
      dataUrl: 'data:${preset.mime};base64,$base64Str',
      width: w,
      height: h,
      approxBytes: encoded.length,
    );
  }

  static int _toJpegQuality(double quality) =>
      (quality * 100).round().clamp(1, 100);

  /// Decodes a stored `data:...;base64,...` URL back to raw bytes, for
  /// rendering via `Image.memory`.
  static Uint8List decodeDataUrl(String dataUrl) {
    final commaIdx = dataUrl.indexOf(',');
    final b64 = commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : dataUrl;
    return base64Decode(b64);
  }
}
