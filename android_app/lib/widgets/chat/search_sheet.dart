import 'package:flutter/material.dart';

import '../../models/message.dart';
import '../../models/user_profile.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/search_filters.dart';
import '../../utils/time_format.dart';

/// Client-side search over the already-loaded message list — port of
/// components/SearchDropdown.jsx. This is NOT a server-side/full-text search: it looks at the
/// messages the chat has loaded, for words and for filters (from:, has:image, before:..., see
/// utils/search_filters.dart), which can be typed or pressed.
void showSearchSheet(
  BuildContext context, {
  required List<ChatMessage> messages,
  required Map<String, UserProfile> usersById,
  required ValueChanged<String> onJump,
  String? meUid,
}) {
  showModalBottomSheet(
    context: context,
    backgroundColor: Palette.bgRaised,
    isScrollControlled: true,
    builder: (context) => _SearchSheet(
      messages: messages,
      usersById: usersById,
      meUid: meUid,
      onJump: onJump,
    ),
  );
}

class _SearchSheet extends StatefulWidget {
  const _SearchSheet({
    required this.messages,
    required this.usersById,
    required this.onJump,
    this.meUid,
  });
  final List<ChatMessage> messages;
  final Map<String, UserProfile> usersById;

  /// Who is searching (for from:me and mentions:me).
  final String? meUid;
  final ValueChanged<String> onJump;

  @override
  State<_SearchSheet> createState() => _SearchSheetState();
}

class _SearchSheetState extends State<_SearchSheet> {
  final _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// A filter button: puts its filter in the box, or takes it out. The box is the one source of
  /// truth, so the buttons and typing agree.
  void _toggle(String token) {
    final next = toggleToken(_controller.text, token);
    _controller.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: next.length),
    );
    setState(() => _query = next);
  }

  /// What stands in for words in a result that has none (a picture or a voice message on its own).
  String _kindOf(ChatMessage m) {
    if (m.imageURL != null) return 'Picture';
    if (m.voice != null) return 'Voice message';
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final found = searchMessages(
      widget.messages,
      _query,
      usersById: widget.usersById,
      meUid: widget.meUid,
    );
    final results = found.results;

    return SafeArea(
      child: DraggableScrollableSheet(
        initialChildSize: 0.75,
        minChildSize: 0.4,
        maxChildSize: 0.95,
        expand: false,
        builder: (context, scrollController) {
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: TextField(
                  controller: _controller,
                  autofocus: true,
                  onChanged: (v) => setState(() => _query = v),
                  decoration: InputDecoration(
                    hintText: 'Search this chat',
                    prefixIcon: Icon(
                      Icons.search,
                      size: 18,
                      color: Palette.inkDim,
                    ),
                    fillColor: Palette.bgDeepest,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppRadii.md),
                      borderSide: BorderSide.none,
                    ),
                    isDense: true,
                  ),
                ),
              ),
              // Sideways, so five buttons take one row of the sheet. (A Row, not a lazy list: there
              // are only five, and all of them should exist, on screen or not.)
              SizedBox(
                height: 40,
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    children: [
                      for (final c in searchChips)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: FilterChip(
                            label: Text(c.label),
                            selected: hasToken(_query, c.token),
                            onSelected: (_) => _toggle(c.token),
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              for (final problem in found.parsed.problems)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 2, 12, 0),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      problem,
                      style: AppTextStyles.xs(color: Palette.warn),
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    !found.active
                        ? 'Type to search'
                        : '${results.length} match${results.length == 1 ? '' : 'es'}',
                    style: AppTextStyles.xs(color: Palette.inkDim),
                  ),
                ),
              ),
              const SizedBox(height: 4),
              if (!found.active)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                  child: Text(
                    'Narrow it down with from:name has:image is:pinned before:2026-11-01 after:… on:… mentions:me',
                    textAlign: TextAlign.center,
                    style: AppTextStyles.xs(color: Palette.inkDim),
                  ),
                ),
              Expanded(
                child: ListView.builder(
                  controller: scrollController,
                  itemCount: results.length,
                  itemBuilder: (context, index) {
                    final m = results[index];
                    final author =
                        widget.usersById[m.author.uid]?.name ?? m.author.name;
                    return ListTile(
                      title: Text(
                        author,
                        style: AppTextStyles.sm(weight: FontWeight.w600),
                      ),
                      subtitle: Text(
                        m.text.isNotEmpty ? m.text : _kindOf(m),
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.sm(
                          color: m.text.isNotEmpty ? Palette.inkMuted : Palette.inkDim,
                        ).copyWith(
                          fontStyle: m.text.isNotEmpty ? null : FontStyle.italic,
                        ),
                      ),
                      trailing: Text(
                        formatSearchResultTime(m.createdAt),
                        style: AppTextStyles.xs(color: Palette.inkDim),
                      ),
                      onTap: () {
                        Navigator.of(context).pop();
                        widget.onJump(m.id);
                      },
                    );
                  },
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
