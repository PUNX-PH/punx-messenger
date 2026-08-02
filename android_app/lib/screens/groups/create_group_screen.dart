import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../providers/auth_providers.dart';
import '../../providers/groups_providers.dart';
import '../../router/route_paths.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

const _maxAvatarBytes = 5 * 1024 * 1024;

/// Port of components/CreateGroupModal.jsx, as a full-screen route (a
/// modal-over-modal on top of the Groups tab's FAB would be cramped).
class CreateGroupScreen extends ConsumerStatefulWidget {
  const CreateGroupScreen({super.key});

  @override
  ConsumerState<CreateGroupScreen> createState() => _CreateGroupScreenState();
}

class _CreateGroupScreenState extends ConsumerState<CreateGroupScreen> {
  final _nameController = TextEditingController();
  Uint8List? _avatarBytes;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _pickAvatar() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (bytes.lengthInBytes > _maxAvatarBytes) {
      setState(() => _error = 'Image is larger than 5 MB.');
      return;
    }
    setState(() {
      _avatarBytes = bytes;
      _error = null;
    });
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Give the group a name.');
      return;
    }
    final owner = ref.read(profileProvider).valueOrNull;
    if (owner == null) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final (groupId, generalChannelId) = await ref
          .read(groupsRepositoryProvider)
          .createGroup(name: name, owner: owner, avatarBytes: _avatarBytes);
      if (mounted) {
        Navigator.of(context).pop();
        context.push(RoutePaths.channelPath(groupId, generalChannelId));
      }
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Palette.bgMain,
      appBar: AppBar(title: const Text('Create a group')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: GestureDetector(
                onTap: _busy ? null : _pickAvatar,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(48),
                  child: Container(
                    width: 96,
                    height: 96,
                    color: Palette.bgRaised,
                    child: _avatarBytes != null
                        ? Image.memory(_avatarBytes!, fit: BoxFit.cover)
                        : const Icon(
                            Icons.add_a_photo_outlined,
                            color: Palette.inkMuted,
                            size: 28,
                          ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _nameController,
              maxLength: 50,
              style: AppTextStyles.base(),
              decoration: InputDecoration(
                labelText: 'Group name',
                fillColor: Palette.bgDeepest,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadii.md),
                ),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: AppTextStyles.sm(color: Palette.bad)),
            ],
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Create group'),
            ),
          ],
        ),
      ),
    );
  }
}
