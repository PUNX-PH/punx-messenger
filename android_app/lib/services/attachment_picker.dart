import 'package:image_picker/image_picker.dart';

import '../utils/attachments.dart';

/// Opens the phone's gallery and returns the pictures chosen, in the order chosen (empty when it
/// was closed without choosing). The Composer takes this as a parameter so a test can hand it
/// pictures without a gallery.
Future<List<Attachment>> pickAttachments() async {
  final picked = await ImagePicker().pickMultiImage();
  return [
    for (final f in picked)
      Attachment(bytes: await f.readAsBytes(), name: f.name),
  ];
}
