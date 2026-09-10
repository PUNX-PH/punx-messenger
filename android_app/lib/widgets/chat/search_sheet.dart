import 'package:flutter/material.dart';

import '../../models/message.dart';
import '../../models/user_profile.dart';
import '../../theme/app_theme.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/constants.dart';
import '../../utils/time_format.dart';

/// Client-side substring search over the already-loaded message list (capped
/// at [AppTiming.messageLoadLimit] by the base query) — port of
/// components/SearchDropdown.jsx. This is NOT a server-side/full-text
/// search; it only matches the `text` field, case-insensitively.
void showSearchSheet(
  BuildContext context, {
  required List<ChatMessage> messages,
  required Map<String, UserProfile> usersById,
  required ValueChanged<String> onJump,
}) {
  showModalBottomSheet(
    context: context,
    backgroundColor: Palette.bgRaised,
    isScrollControlled: true,
    builder: (context) =>
        _SearchSheet(messages: messages, usersById: usersById, onJump: onJump),
  );
}

class _SearchSheet extends StatefulWidget {
  const _SearchSheet({
    required this.messages,
    required this.usersById,
    required this.onJump,
  });
  final List<ChatMessage> messages;
  final Map<String, UserProfile> usersById;
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

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();
    final results = q.isEmpty
        ? const <ChatMessage>[]
        : widget.messages
              .where((m) => m.text.toLowerCase().contains(q))
              .toList()
              .reversed
              .take(AppTiming.searchResultCap)
              .toList();

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
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    q.isEmpty
                        ? 'Type to search'
                        : '${results.length} match${results.length == 1 ? '' : 'es'}',
                    style: AppTextStyles.xs(color: Palette.inkDim),
                  ),
                ),
              ),
              const SizedBox(height: 4),
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
                        m.text,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.sm(color: Palette.inkMuted),
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
