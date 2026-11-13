import 'package:flutter/material.dart';

import '../../models/custom_emoji.dart';
import '../../models/message.dart';
import '../../models/user_profile.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';
import '../../utils/constants.dart';
import '../../utils/new_line.dart';
import '../../utils/time_format.dart';
import 'message_row.dart';

/// Within this distance of the end the reader counts as "at the bottom": new
/// messages follow them down instead of waiting behind the jump pill.
const _nearBottomPx = 80.0;

/// Past this the jump pill appears even with nothing new, so there is always a
/// way back from deep in the history. Between the two, only the unread count
/// shows it.
const _farFromBottomPx = 400.0;

/// Scrollable message feed — port of components/MessageList.jsx. Handles
/// Discord-style same-author/5-min clustering, day dividers, the
/// jump-to-latest pill, and jump-to-message (used by reply-quote taps and by
/// search/pinned-message jumps).
class MessageListView extends StatefulWidget {
  const MessageListView({
    super.key,
    required this.messages,
    required this.meUid,
    required this.usersById,
    required this.emojiByName,
    required this.canDeleteAny,
    required this.emptyTitle,
    required this.emptyDesc,
    this.canPin = false,
    this.hasMore = false,
    this.onLoadOlder,
    this.scrollToId,
    this.newFromId,
    this.onReply,
    this.onEdit,
    this.onDelete,
    this.onTogglePin,
    this.onReact,
    this.onJumpToMessage,
  });

  final List<ChatMessage> messages;
  final String? meUid;
  final Map<String, UserProfile> usersById;
  final Map<String, CustomEmoji> emojiByName;
  final bool canDeleteAny;
  final bool canPin;
  final String emptyTitle;
  final String emptyDesc;

  /// Whether older messages exist behind the loaded window, i.e. whether
  /// scrolling to the top should fetch more.
  final bool hasMore;

  /// Widens the loaded window by one page. See messageLimitProvider.
  final VoidCallback? onLoadOlder;

  /// Set (to a new, non-null value) to scroll a specific message into view
  /// and briefly highlight it, pausing normal auto-follow-latest behavior.
  final String? scrollToId;

  /// The first message the reader had not read when the conversation opened: a
  /// "New" line goes just above it, and a pill takes them back to it when it has
  /// scrolled out of sight above. See firstUnreadId.
  final String? newFromId;

  final ValueChanged<ChatMessage>? onReply;
  final void Function(ChatMessage message, String newText)? onEdit;
  final ValueChanged<ChatMessage>? onDelete;
  final ValueChanged<ChatMessage>? onTogglePin;
  final void Function(ChatMessage message, String key)? onReact;
  final ValueChanged<String>? onJumpToMessage;

  @override
  State<MessageListView> createState() => _MessageListViewState();
}

class _MessageListViewState extends State<MessageListView> {
  final _scrollController = ScrollController();
  double? _anchorExtent; // scroll metrics captured just before a page lands
  String? _firstId;
  final Map<String, GlobalKey> _rowKeys = {};
  String? _highlightId;

  /// The "New" line: its key (to find it on screen), where it sits in the flattened
  /// list, the range of rows currently built, and whether it has scrolled out of
  /// sight above. A ListView only builds the rows near the screen, so a row far
  /// above has no widget to measure: its position is known only by its index.
  final _newLineKey = GlobalKey();
  int? _newLineIndex;
  int _firstBuilt = 0;
  int _lastBuilt = -1;
  bool _newLineAbove = false;

  /// Whether the reader is at the end of the feed — new messages follow them.
  bool _stickToBottom = true;

  /// Far enough up that the jump pill is worth showing on its own.
  bool _away = false;

  /// Messages that arrived at the bottom while the reader was up in the
  /// history. Counted off the NEWEST id: an older page landing at the top
  /// changes the length too and must not read as news.
  int _unseen = 0;
  String? _newestId;
  int? _newestMs;

  @override
  void initState() {
    super.initState();
    _firstId = widget.messages.isEmpty ? null : widget.messages.first.id;
    _rememberNewest();
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
    _scrollController.addListener(_onScroll);
  }

  ChatMessage? get _newest =>
      widget.messages.isEmpty ? null : widget.messages.last;

  void _rememberNewest() {
    _newestId = _newest?.id;
    _newestMs = _newest?.createdAt?.millisecondsSinceEpoch;
  }

  void _onScroll() {
    _trackBottom();
    _maybeLoadOlder();
    _checkNewLine();
  }

  /// Keeps [_stickToBottom] / [_away] honest as the reader scrolls, rebuilding
  /// only when one of them actually flips.
  void _trackBottom() {
    if (!_scrollController.hasClients) return;
    final p = _scrollController.position;
    final distance = p.maxScrollExtent - p.pixels;
    final stick = distance <= _nearBottomPx;
    final away = distance > _farFromBottomPx;
    final clearsUnseen = stick && _unseen > 0;
    if (stick == _stickToBottom && away == _away && !clearsUnseen) return;
    setState(() {
      _stickToBottom = stick;
      _away = away;
      if (stick) _unseen = 0;
    });
  }

  /// Near the top and more history behind us: widen the window.
  ///
  /// The extent is captured BEFORE the taller list renders, so
  /// [didUpdateWidget] can restore the reader's position afterwards.
  void _maybeLoadOlder() {
    if (!widget.hasMore || widget.onLoadOlder == null) return;
    if (!_scrollController.hasClients) return;
    if (_scrollController.position.pixels > 200) return;
    if (_anchorExtent != null) return; // a page is already in flight
    _anchorExtent = _scrollController.position.maxScrollExtent;
    widget.onLoadOlder!();
  }

  @override
  void didUpdateWidget(covariant MessageListView oldWidget) {
    super.didUpdateWidget(oldWidget);

    // The line was just placed, moved or removed: look again once it is laid out.
    if (widget.newFromId != oldWidget.newFromId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _checkNewLine();
      });
    }

    // A different conversation in the same widget: start clean rather than
    // carrying the last channel's "3 new messages" into this one.
    if (widget.meUid != oldWidget.meUid ||
        widget.emptyTitle != oldWidget.emptyTitle) {
      _anchorExtent = null;
      _firstId = widget.messages.isEmpty ? null : widget.messages.first.id;
      _rememberNewest();
      _unseen = 0;
      _away = false;
      _newLineAbove = false;
      _stickToBottom = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
      return;
    }

    if (widget.scrollToId != null &&
        widget.scrollToId != oldWidget.scrollToId) {
      _rememberNewest();
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _jumpToMessage(widget.scrollToId!),
      );
      return;
    }
    if (widget.scrollToId != null) {
      _rememberNewest(); // paused, but keep the baseline current
      return;
    }

    final prevId = _newestId;
    final prevMs = _newestMs;
    final firstId = widget.messages.isEmpty ? null : widget.messages.first.id;
    final grewAtTop =
        _firstId != null && firstId != _firstId && _anchorExtent != null;
    _firstId = firstId;
    _rememberNewest();

    if (grewAtTop) {
      // Older messages landed above the viewport. Restoring the distance
      // from the BOTTOM keeps the same content under the reader's eyes;
      // jumping to the end here is what would yank them out of history.
      final before = _anchorExtent!;
      _anchorExtent = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_scrollController.hasClients) return;
        final after = _scrollController.position.maxScrollExtent;
        _scrollController.jumpTo(
          _scrollController.position.pixels + (after - before),
        );
      });
      return;
    }

    if (_newestId == prevId) return; // nothing new at the bottom

    final newest = _newest;
    if (prevId == null) {
      // The feed was empty and has just filled.
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
      return;
    }

    final mine =
        newest != null &&
        widget.meUid != null &&
        newest.author.uid == widget.meUid;
    if (mine) {
      // You just sent it, so you want to see it wherever you had scrolled to.
      // Counting it as "1 new message" and leaving it off screen was the old
      // behaviour.
      _stickToBottom = true;
      _unseen = 0;
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
      return;
    }
    // Deleting the newest message makes an OLDER one the newest. That is a
    // message going away, not one arriving.
    final newestMs = _newestMs;
    if (newestMs != null && prevMs != null && newestMs < prevMs) return;

    if (_stickToBottom) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
    } else {
      // Plain assignment, not setState: this runs just ahead of build().
      _unseen += 1;
    }
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  /// Scrolls to the true end of the feed.
  ///
  /// A ListView only knows the height of the rows it has built and ESTIMATES the
  /// rest, so the end it reports before scrolling is not the end it reports
  /// after: animating to the first figure can stop short, with the newest
  /// messages still below the fold. Re-check once it lands and finish with a
  /// jump, a few times at most.
  Future<void> _jumpToBottom() async {
    for (var attempt = 0; attempt < 4; attempt++) {
      if (!mounted || !_scrollController.hasClients) return;
      final end = _scrollController.position.maxScrollExtent;
      if (attempt == 0) {
        await _scrollController.animateTo(
          end,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      } else {
        _scrollController.jumpTo(end);
      }
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted || !_scrollController.hasClients) return;
      final p = _scrollController.position;
      if (p.maxScrollExtent - p.pixels <= 1) return;
    }
  }

  void _jumpToLatest() {
    setState(() {
      _stickToBottom = true;
      _unseen = 0;
    });
    _jumpToBottom();
  }

  /// Called after every layout with the range of rows that is built. Only a
  /// change in the range is acted on, and the work is deferred to after the frame:
  /// this runs in the middle of layout, where setState is not allowed.
  void _onBuilt(int first, int last) {
    if (first == _firstBuilt && last == _lastBuilt) return;
    _firstBuilt = first;
    _lastBuilt = last;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _checkNewLine();
    });
  }

  /// Is the "New" line completely out of sight above the list? If its row is built
  /// it is measured on screen; if not, it is above exactly when its index is before
  /// the first row that is built.
  void _checkNewLine() {
    final index = _newLineIndex;
    var above = false;
    if (index != null && _scrollController.hasClients) {
      final ctx = _newLineKey.currentContext;
      if (ctx != null && index >= _firstBuilt && index <= _lastBuilt) {
        final box = ctx.findRenderObject();
        final viewport = Scrollable.maybeOf(ctx)?.context.findRenderObject();
        if (box is RenderBox &&
            box.attached &&
            viewport is RenderBox &&
            viewport.attached) {
          above = newLineIsAbove(
            box.localToGlobal(Offset(0, box.size.height)).dy,
            viewport.localToGlobal(Offset.zero).dy,
          );
        }
      } else {
        above = index < _firstBuilt;
      }
    }
    if (above != _newLineAbove && mounted) {
      setState(() => _newLineAbove = above);
    }
  }

  /// Takes the reader to the "New" line. Following the newest is switched off
  /// first, or the next arrival would pull the view straight back down.
  ///
  /// The line's row may not exist yet (rows far off screen are not built), so
  /// first jump to a guess from its index, then step towards it a screen at a
  /// time until it is built, and only then scroll it into place.
  Future<void> _jumpToNewLine() async {
    setState(() => _stickToBottom = false);
    var guessed = false;
    for (var attempt = 0; attempt < 80; attempt++) {
      if (!mounted || !_scrollController.hasClients) return;
      final index = _newLineIndex;
      if (index == null) return;
      final p = _scrollController.position;
      final ctx = _newLineKey.currentContext;
      if (ctx != null &&
          ctx.mounted &&
          index >= _firstBuilt &&
          index <= _lastBuilt) {
        await Scrollable.ensureVisible(
          ctx,
          duration: const Duration(milliseconds: 300),
          alignment: 0.1,
        );
        if (mounted) _checkNewLine();
        return;
      }
      double target;
      if (!guessed && _itemCount > 1) {
        guessed = true;
        target = p.maxScrollExtent * (index / (_itemCount - 1));
      } else {
        final step = p.viewportDimension;
        target = index < _firstBuilt ? p.pixels - step : p.pixels + step;
      }
      target = target.clamp(p.minScrollExtent, p.maxScrollExtent);
      if (target == p.pixels && guessed && attempt > 0) {
        return; // nowhere left to go
      }
      _scrollController.jumpTo(target);
      await WidgetsBinding.instance.endOfFrame;
    }
  }

  int _itemCount = 0;

  void _jumpToMessage(String id) {
    final ctx = _rowKeys[id]?.currentContext;
    if (ctx == null) return;
    setState(() => _highlightId = id);
    Scrollable.ensureVisible(
      ctx,
      duration: const Duration(milliseconds: 300),
      alignment: 0.5,
    );
    Future.delayed(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _highlightId = null);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.messages.isEmpty) {
      return _EmptyState(title: widget.emptyTitle, desc: widget.emptyDesc);
    }

    final items = _flatten(widget.messages, widget.newFromId);
    _itemCount = items.length;
    final newLineAt = items.indexWhere((i) => i is _NewItem);
    _newLineIndex = newLineAt < 0 ? null : newLineAt;
    final list = ListView.custom(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(vertical: 8),
      semanticChildCount: items.length,
      childrenDelegate: _ReportingDelegate(
        childCount: items.length,
        onLayout: _onBuilt,
        (context, index) {
          final item = items[index];
          if (item is _NewItem) {
            return KeyedSubtree(key: _newLineKey, child: const _NewDivider());
          }
          if (item is _DayItem) {
            return _DayDivider(
              key: ValueKey(
                'day-${item.day.year}-${item.day.month}-${item.day.day}',
              ),
              day: item.day,
            );
          }
          final entry = item as _MessageItem;
          final key = _rowKeys.putIfAbsent(entry.message.id, () => GlobalKey());
          return KeyedSubtree(
            key: key,
            child: MessageRow(
              message: entry.message,
              showHeader: entry.showHeader,
              meUid: widget.meUid,
              usersById: widget.usersById,
              emojiByName: widget.emojiByName,
              canDeleteAny: widget.canDeleteAny,
              canPin: widget.canPin,
              highlighted: _highlightId == entry.message.id,
              onReply: widget.onReply,
              onEdit: widget.onEdit,
              onDelete: widget.onDelete,
              onTogglePin: widget.onTogglePin,
              onReact: widget.onReact,
              onJumpToMessage: widget.onJumpToMessage,
            ),
          );
        },
      ),
    );

    // `_unseen` alone is enough to show the pill. New messages are counted from
    // _nearBottomPx up, but distance alone only turns it on past
    // _farFromBottomPx — so in between, messages would arrive with no sign.
    final showPill = _away || _unseen > 0;
    return Stack(
      children: [
        Positioned.fill(child: list),
        // The "New" line has scrolled out of sight above: a way back up to it.
        if (_newLineAbove)
          Positioned(
            left: 0,
            right: 0,
            top: 12,
            child: Center(
              child: _PillButton(
                label: 'Jump to first unread',
                icon: Icons.arrow_upward,
                onTap: _jumpToNewLine,
              ),
            ),
          ),
        if (showPill)
          Positioned(
            left: 0,
            right: 0,
            bottom: 12,
            child: Center(
              child: _JumpPill(unseen: _unseen, onTap: _jumpToLatest),
            ),
          ),
      ],
    );
  }
}

sealed class _ListItem {
  const _ListItem();
}

class _DayItem extends _ListItem {
  const _DayItem(this.day);
  final DateTime day;
}

class _NewItem extends _ListItem {
  const _NewItem();
}

class _MessageItem extends _ListItem {
  const _MessageItem(this.message, this.showHeader);
  final ChatMessage message;
  final bool showHeader;
}

/// Same-author clustering: a message joins the previous group if the same
/// author sent it within [AppTiming.messageGroupingWindowMs] of the
/// *immediately preceding* message (not the group's first message). A new day
/// always starts a new group, and gets a divider.
List<_ListItem> _flatten(List<ChatMessage> messages, [String? newFromId]) {
  final out = <_ListItem>[];
  ChatMessage? prev;
  DateTime? prevDay;
  for (final m in messages) {
    final day = m.createdAt?.toDate();
    var newDay = false;
    // A message with no timestamp yet (a pending local write) belongs to
    // whatever day it is sitting in, so it never opens a divider.
    if (day != null && (prevDay == null || !isSameDay(prevDay, day))) {
      out.add(_DayItem(day));
      newDay = true;
    }
    if (day != null) prevDay = day;

    // The "New" line goes just above the first unread message, which also starts
    // a group, so the line never cuts a run by one person in two.
    final newLine = newFromId != null && m.id == newFromId;
    if (newLine) out.add(const _NewItem());
    final showHeader =
        newDay ||
        newLine ||
        prev == null ||
        prev.author.uid != m.author.uid ||
        _msSincePrev(prev, m) >= AppTiming.messageGroupingWindowMs;
    out.add(_MessageItem(m, showHeader));
    prev = m;
  }
  return out;
}

int _msSincePrev(ChatMessage prev, ChatMessage cur) {
  final p = prev.createdAt?.millisecondsSinceEpoch;
  final c = cur.createdAt?.millisecondsSinceEpoch;
  if (p == null || c == null) {
    return AppTiming
        .messageGroupingWindowMs; // force a new group if a timestamp is missing
  }
  return c - p;
}

class _DayDivider extends StatelessWidget {
  const _DayDivider({super.key, required this.day});
  final DateTime day;

  @override
  Widget build(BuildContext context) {
    final label = dayLabel(day);
    Widget rule() =>
        Expanded(child: Container(height: 1, color: Palette.lineSubtle));
    return Semantics(
      container: true,
      label: label,
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              rule(),
              const SizedBox(width: 12),
              // Flexible and centred, not a fixed one-liner: at a large text
              // scale on a narrow phone "Wednesday, September 30, 2026" wraps
              // rather than overflowing the row.
              Flexible(
                flex: 4,
                child: Text(
                  label,
                  textAlign: TextAlign.center,
                  style: AppTextStyles.xs(
                    color: Palette.inkMuted,
                    weight: FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              rule(),
            ],
          ),
        ),
      ),
    );
  }
}

class _JumpPill extends StatelessWidget {
  const _JumpPill({required this.unseen, required this.onTap});
  final int unseen;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final label = unseen > 0
        ? '$unseen new ${unseen == 1 ? 'message' : 'messages'}'
        : 'Jump to latest';
    return _PillButton(label: label, icon: Icons.arrow_downward, onTap: onTap);
  }
}

/// A rounded button floating over the feed: "Jump to latest" at the bottom, and
/// "Jump to first unread" at the top.
class _PillButton extends StatelessWidget {
  const _PillButton({
    required this.label,
    required this.icon,
    required this.onTap,
  });
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: ExcludeSemantics(
        child: Material(
          color: Palette.brand,
          elevation: 3,
          shape: const StadiumBorder(),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: onTap,
            child: ConstrainedBox(
              // Material's 48dp minimum touch target.
              constraints: const BoxConstraints(minHeight: 48),
              child: Padding(
                padding: const EdgeInsets.only(left: 14, right: 16),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(icon, size: 16, color: Colors.white),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        label,
                        style: AppTextStyles.xs(
                          color: Colors.white,
                          weight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// "Everything below this you had not read when you opened the chat."
class _NewDivider extends StatelessWidget {
  const _NewDivider();

  @override
  Widget build(BuildContext context) {
    Widget rule() => Expanded(
      child: Container(height: 1, color: Palette.bad.withValues(alpha: 0.6)),
    );
    return Semantics(
      container: true,
      label: 'New messages',
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              rule(),
              const SizedBox(width: 12),
              Text(
                'NEW',
                style: AppTextStyles.xs(
                  color: Palette.bad,
                  weight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 12),
              rule(),
            ],
          ),
        ),
      ),
    );
  }
}

/// The usual lazy list of rows, plus a report after each layout of which rows are
/// built (the "New" line's row only exists while it is near the screen).
class _ReportingDelegate extends SliverChildBuilderDelegate {
  _ReportingDelegate(super.builder, {super.childCount, required this.onLayout});
  final void Function(int firstIndex, int lastIndex) onLayout;

  @override
  void didFinishLayout(int firstIndex, int lastIndex) =>
      onLayout(firstIndex, lastIndex);
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, required this.desc});
  final String title;
  final String desc;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              textAlign: TextAlign.center,
              style: AppTextStyles.base(weight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Text(
              desc,
              textAlign: TextAlign.center,
              style: AppTextStyles.sm(color: Palette.inkMuted),
            ),
          ],
        ),
      ),
    );
  }
}
