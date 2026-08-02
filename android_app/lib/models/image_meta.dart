/// Mirrors the `imageMeta` object embedded on a message doc in db.js's
/// sendMessage(), produced by images.js's resizeToDataUrl().
class ImageMeta {
  final int width;
  final int height;
  final int approxBytes;
  final String originalName;

  const ImageMeta({
    required this.width,
    required this.height,
    required this.approxBytes,
    required this.originalName,
  });

  static ImageMeta? fromMap(Map<String, dynamic>? data) {
    if (data == null) return null;
    return ImageMeta(
      width: (data['width'] as num?)?.toInt() ?? 0,
      height: (data['height'] as num?)?.toInt() ?? 0,
      approxBytes: (data['approxBytes'] as num?)?.toInt() ?? 0,
      originalName: (data['originalName'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toMap() => {
    'width': width,
    'height': height,
    'approxBytes': approxBytes,
    'originalName': originalName,
  };
}
