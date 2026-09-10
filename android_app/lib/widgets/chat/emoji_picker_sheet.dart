import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../models/custom_emoji.dart';
import '../../providers/auth_providers.dart';
import '../../providers/emojis_providers.dart';
import '../../services/image_service.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

const _quickEmojis = [
  '👍',
  '❤️',
  '😂',
  '🎉',
  '🔥',
  '😮',
  '😢',
  '🙏',
  '👀',
  '✅',
];

/// Returns the picked token: a raw unicode emoji, or `:name:` for a custom
/// emoji — or null if dismissed. Port of components/EmojiPicker.jsx.
Future<String?> showEmojiPickerSheet(BuildContext context) {
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: Palette.bgRaised,
    isScrollControlled: true,
    builder: (context) => const _EmojiPickerSheet(),
  );
}

class _EmojiPickerSheet extends ConsumerStatefulWidget {
  const _EmojiPickerSheet();

  @override
  ConsumerState<_EmojiPickerSheet> createState() => _EmojiPickerSheetState();
}

class _EmojiPickerSheetState extends ConsumerState<_EmojiPickerSheet> {
  final _filterController = TextEditingController();
  String _filter = '';
  bool _uploading = false;

  @override
  void dispose() {
    _filterController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final emojis = ref.watch(emojisStreamProvider).valueOrNull ?? const [];
    final isAdmin =
        ref.watch(profileProvider).valueOrNull?.role.isAdmin ?? false;
    final f = _filter.trim().toLowerCase();
    final filtered = f.isEmpty
        ? emojis
        : emojis.where((e) => e.name.contains(f)).toList();

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: DraggableScrollableSheet(
          initialChildSize: 0.6,
          minChildSize: 0.3,
          maxChildSize: 0.9,
          expand: false,
          builder: (context, scrollController) {
            return ListView(
              controller: scrollController,
              padding: const EdgeInsets.all(12),
              children: [
                TextField(
                  controller: _filterController,
                  onChanged: (v) => setState(() => _filter = v),
                  decoration: InputDecoration(
                    hintText: 'Search custom emoji',
                    fillColor: Palette.bgDeepest,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadii.md),
                      borderSide: BorderSide.none,
                    ),
                    isDense: true,
                  ),
                ),
                if (f.isEmpty) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final e in _quickEmojis)
                        GestureDetector(
                          onTap: () => Navigator.of(context).pop(e),
                          child: Text(e, style: const TextStyle(fontSize: 26)),
                        ),
                    ],
                  ),
                  const Divider(height: 24),
                ],
                if (emojis.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      'No custom emojis yet.',
                      style: AppTextStyles.sm(color: Palette.inkMuted),
                    ),
                  )
                else if (filtered.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      'No match.',
                      style: AppTextStyles.sm(color: Palette.inkMuted),
                    ),
                  )
                else
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 6,
                        ),
                    itemCount: filtered.length,
                    itemBuilder: (context, index) {
                      final e = filtered[index];
                      return GestureDetector(
                        onTap: () => Navigator.of(context).pop(':${e.name}:'),
                        child: Padding(
                          padding: const EdgeInsets.all(4),
                          child: Image.memory(
                            ImageService.decodeDataUrl(e.dataURL),
                          ),
                        ),
                      );
                    },
                  ),
                if (isAdmin) ...[
                  const Divider(height: 24),
                  OutlinedButton.icon(
                    onPressed: _uploading ? null : _uploadEmoji,
                    icon: _uploading
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.add),
                    label: const Text('Upload custom emoji'),
                  ),
                  if (emojis.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(
                      'Manage emojis',
                      style: AppTextStyles.xs(
                        color: Palette.inkDim,
                        weight: FontWeight.w600,
                      ),
                    ),
                    for (final e in emojis) _ManageEmojiRow(emoji: e),
                  ],
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _uploadEmoji() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (file == null) return;
    final Uint8List bytes = await file.readAsBytes();

    final derivedName = file.name
        .replaceAll(RegExp(r'\.[^.]+$'), '')
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9_]'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
    final nameController = TextEditingController(
      text: derivedName.isEmpty
          ? 'emoji'
          : derivedName.substring(0, derivedName.length.clamp(0, 32)),
    );

    if (!mounted) return;
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Palette.bgRaised,
        title: const Text('Name this emoji'),
        content: TextField(controller: nameController, autofocus: true),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(nameController.text),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (name == null || name.trim().isEmpty) return;

    final createdBy = ref.read(profileProvider).valueOrNull?.id;
    if (createdBy == null) return;
    setState(() => _uploading = true);
    try {
      await ref
          .read(emojisRepositoryProvider)
          .createEmoji(name: name, bytes: bytes, createdBy: createdBy);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }
}

class _ManageEmojiRow extends ConsumerWidget {
  const _ManageEmojiRow({required this.emoji});
  final CustomEmoji emoji;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Image.memory(
        ImageService.decodeDataUrl(emoji.dataURL),
        width: 24,
        height: 24,
      ),
      title: Text(':${emoji.name}:', style: AppTextStyles.sm()),
      trailing: IconButton(
        icon: Icon(Icons.delete_outline, size: 18, color: Palette.bad),
        onPressed: () async {
          final confirmed = await showDialog<bool>(
            context: context,
            builder: (context) => AlertDialog(
              backgroundColor: Palette.bgRaised,
              title: Text('Delete :${emoji.name}:?'),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Cancel'),
                ),
                TextButton(
                  onPressed: () => Navigator.of(context).pop(true),
                  child: Text(
                    'Delete',
                    style: TextStyle(color: Palette.bad),
                  ),
                ),
              ],
            ),
          );
          if (confirmed == true) {
            await ref.read(emojisRepositoryProvider).deleteEmoji(emoji.id);
          }
        },
      ),
    );
  }
}
