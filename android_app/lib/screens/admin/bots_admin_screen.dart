import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_providers.dart';
import '../../providers/bots_providers.dart';
import '../../services/bot_service.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// Bot management. Port of `components/BotsAdmin.jsx`, which the web mounts
/// inside its admin panel; on a phone that would mean two long lists sharing
/// one scroll, so this is its own screen instead.
///
/// The delicate part, carried over verbatim from the web's comment: an API key
/// exists in plaintext for exactly as long as this screen holds it in memory.
/// Only its hash is ever written, so a key that is not copied out of the banner
/// is gone, and rotating is the only recovery. The banner says so.
class BotsAdminScreen extends ConsumerStatefulWidget {
  const BotsAdminScreen({super.key});

  @override
  ConsumerState<BotsAdminScreen> createState() => _BotsAdminScreenState();
}

class _BotsAdminScreenState extends ConsumerState<BotsAdminScreen> {
  /// Held in memory only, never persisted anywhere.
  ({String name, String apiKey})? _freshKey;
  String? _error;
  bool _busy = false;

  Future<void> _create() async {
    final me = ref.read(profileProvider).valueOrNull;
    if (me == null) return;
    final draft = await showModalBottomSheet<_BotDraft>(
      context: context,
      backgroundColor: Palette.bgRaised,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _CreateBotSheet(),
    );
    if (draft == null || !mounted) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await ref.read(botServiceProvider).createBot(
            name: draft.name,
            description: draft.description,
            scopes: draft.scopes,
            createdBy: me.id,
          );
      if (mounted) {
        setState(() => _freshKey = (name: draft.name, apiKey: res.apiKey));
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not create the bot. $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rotate(Bot bot) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        backgroundColor: Palette.bgRaised,
        title: Text('Rotate key?', style: AppTextStyles.base()),
        content: Text(
          'The current key for ${bot.name} stops working immediately. Anything '
          'using it has to be updated with the new one.',
          style: AppTextStyles.sm(color: Palette.inkDim),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(c).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(c).pop(true),
            child: Text('Rotate', style: AppTextStyles.sm(color: Palette.warn)),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final key = await ref.read(botServiceProvider).rotateBotKey(bot.uid);
      if (mounted) setState(() => _freshKey = (name: bot.name, apiKey: key));
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not rotate the key. $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final bots = ref.watch(botsStreamProvider);

    return Scaffold(
      backgroundColor: Palette.bgMain,
      appBar: AppBar(
        title: const Text('Bots'),
        actions: [
          IconButton(
            tooltip: 'New bot',
            onPressed: _busy ? null : _create,
            icon: const Icon(Icons.add),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_freshKey != null) _KeyBanner(
            name: _freshKey!.name,
            apiKey: _freshKey!.apiKey,
            onDismiss: () => setState(() => _freshKey = null),
          ),
          if (_error != null)
            Container(
              width: double.infinity,
              color: Palette.bad.withValues(alpha: 0.12),
              padding: const EdgeInsets.all(12),
              child: Text(_error!, style: AppTextStyles.xs(color: Palette.bad)),
            ),
          Expanded(
            child: bots.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'Could not load bots. $e',
                    textAlign: TextAlign.center,
                    style: AppTextStyles.sm(color: Palette.bad),
                  ),
                ),
              ),
              data: (list) => list.isEmpty
                  ? Center(
                      child: Text(
                        'No bots yet. Tap + to create one.',
                        style: AppTextStyles.sm(color: Palette.inkMuted),
                      ),
                    )
                  : ListView.separated(
                      itemCount: list.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (_, i) => _BotRow(
                        bot: list[i],
                        onRotate: () => _rotate(list[i]),
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BotRow extends ConsumerWidget {
  const _BotRow({required this.bot, required this.onRotate});

  final Bot bot;
  final VoidCallback onRotate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final labels = {for (final s in botScopes) s.id: s.label};
    return ListTile(
      title: Row(
        children: [
          Expanded(
            child: Text(
              bot.name,
              style: AppTextStyles.sm(),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (!bot.enabled)
            Text('off', style: AppTextStyles.xs(color: Palette.inkMuted)),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (bot.description.isNotEmpty)
            Text(
              bot.description,
              style: AppTextStyles.xs(color: Palette.inkMuted),
            ),
          const SizedBox(height: 4),
          Text(
            // Scope ids are the enforcement surface, but the labels are what a
            // person can act on; show labels and fall back to the raw id so an
            // unknown scope is never silently invisible.
            bot.scopes.isEmpty
                ? 'No scopes — it can do nothing'
                : bot.scopes.map((s) => labels[s] ?? s).join(' · '),
            style: AppTextStyles.xs(color: Palette.inkDim),
          ),
        ],
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: 'Rotate key',
            icon: const Icon(Icons.key, size: 18),
            onPressed: onRotate,
          ),
          Switch(
            value: bot.enabled,
            onChanged: (v) =>
                ref.read(botServiceProvider).setBotEnabled(bot.uid, v),
          ),
        ],
      ),
    );
  }
}

/// Shown once, after create or rotate.
class _KeyBanner extends StatelessWidget {
  const _KeyBanner({
    required this.name,
    required this.apiKey,
    required this.onDismiss,
  });

  final String name;
  final String apiKey;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Palette.warn.withValues(alpha: 0.12),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'API key for $name — copy it now',
            style: AppTextStyles.sm(color: Palette.warn),
          ),
          const SizedBox(height: 2),
          Text(
            'Only its hash is stored. Once this is dismissed the key cannot be '
            'shown again; rotating is the only way to get a new one.',
            style: AppTextStyles.xs(color: Palette.inkDim),
          ),
          const SizedBox(height: 8),
          SelectableText(
            apiKey,
            style: AppTextStyles.xs(color: Palette.ink),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              TextButton.icon(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: apiKey));
                },
                icon: const Icon(Icons.copy, size: 16),
                label: const Text('Copy'),
              ),
              const Spacer(),
              TextButton(onPressed: onDismiss, child: const Text('Dismiss')),
            ],
          ),
        ],
      ),
    );
  }
}

class _BotDraft {
  const _BotDraft(this.name, this.description, this.scopes);
  final String name;
  final String description;
  final Set<String> scopes;
}

class _CreateBotSheet extends StatefulWidget {
  const _CreateBotSheet();

  @override
  State<_CreateBotSheet> createState() => _CreateBotSheetState();
}

class _CreateBotSheetState extends State<_CreateBotSheet> {
  final _name = TextEditingController();
  final _description = TextEditingController();
  // Same default as the web: the one scope a bot is almost always for.
  final _scopes = <String>{'messages:write'};

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.75,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Column(
                  children: [
                    TextField(
                      controller: _name,
                      style: AppTextStyles.sm(),
                      decoration: const InputDecoration(labelText: 'Name'),
                      onChanged: (_) => setState(() {}),
                    ),
                    TextField(
                      controller: _description,
                      style: AppTextStyles.sm(),
                      decoration: const InputDecoration(
                        labelText: 'What is it for? (optional)',
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                      child: Text(
                        'SCOPES',
                        style: AppTextStyles.xs(
                          color: Palette.inkDim,
                          weight: FontWeight.w700,
                        ),
                      ),
                    ),
                    for (final s in botScopes)
                      CheckboxListTile(
                        value: _scopes.contains(s.id),
                        onChanged: (v) => setState(() {
                          if (v == true) {
                            _scopes.add(s.id);
                          } else {
                            _scopes.remove(s.id);
                          }
                        }),
                        title: Text(s.label, style: AppTextStyles.sm()),
                        subtitle: Text(
                          s.hint,
                          style: AppTextStyles.xs(color: Palette.inkMuted),
                        ),
                      ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Row(
                  children: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Cancel'),
                    ),
                    const Spacer(),
                    FilledButton(
                      onPressed: _name.text.trim().isEmpty
                          ? null
                          : () => Navigator.of(context).pop(
                                _BotDraft(
                                  _name.text,
                                  _description.text,
                                  _scopes,
                                ),
                              ),
                      child: const Text('Create'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
