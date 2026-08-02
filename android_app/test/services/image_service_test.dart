import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:punx_messenger/services/image_service.dart';

Uint8List _fakePhoto(int width, int height) {
  final image = img.Image(width: width, height: height);
  // Fill with per-pixel noise so it isn't trivially compressible — a more
  // realistic stand-in for a real photo than a flat color block.
  var seed = 42;
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      image.setPixelRgb(
        x,
        y,
        seed & 0xff,
        (seed >> 8) & 0xff,
        (seed >> 16) & 0xff,
      );
    }
  }
  return Uint8List.fromList(img.encodePng(image));
}

void main() {
  group('ImageService.resizeToDataUrl', () {
    test('downscales to fit maxSide and never upscales', () async {
      final bytes = _fakePhoto(400, 200);
      final out = await ImageService.resizeToDataUrl(
        bytes,
        const ImagePreset(maxSide: 100, quality: 0.8, mime: 'image/jpeg'),
      );
      expect(out.width, 100);
      expect(out.height, 50);
      expect(out.dataUrl, startsWith('data:image/jpeg;base64,'));
    });

    test('leaves an already-small image at its original size', () async {
      final bytes = _fakePhoto(40, 20);
      final out = await ImageService.resizeToDataUrl(
        bytes,
        const ImagePreset(maxSide: 128, quality: 0.9, mime: 'image/jpeg'),
      );
      expect(out.width, 40);
      expect(out.height, 20);
    });

    test(
      'PNG preset preserves the mime type (for emoji transparency)',
      () async {
        final bytes = _fakePhoto(40, 40);
        final out = await ImageService.resizeToDataUrl(
          bytes,
          ImagePresets.emoji,
        );
        expect(out.dataUrl, startsWith('data:image/png;base64,'));
      },
    );

    test('approxBytes matches the actual encoded byte length', () async {
      final bytes = _fakePhoto(64, 64);
      final out = await ImageService.resizeToDataUrl(
        bytes,
        ImagePresets.avatar,
      );
      final decoded = ImageService.decodeDataUrl(out.dataUrl);
      expect(out.approxBytes, decoded.length);
    });

    test('rejects non-image bytes', () async {
      final bogus = Uint8List.fromList([1, 2, 3, 4, 5]);
      expect(
        () => ImageService.resizeToDataUrl(bogus, ImagePresets.avatar),
        throwsA(isA<ImageProcessingException>()),
      );
    });
  });

  group('ImageService.decodeDataUrl', () {
    test('round-trips through resizeToDataUrl', () async {
      final bytes = _fakePhoto(32, 32);
      final out = await ImageService.resizeToDataUrl(bytes, ImagePresets.emoji);
      final decoded = ImageService.decodeDataUrl(out.dataUrl);
      final redecoded = img.decodeImage(decoded);
      expect(redecoded, isNotNull);
      expect(redecoded!.width, 32);
      expect(redecoded.height, 32);
    });
  });
}
