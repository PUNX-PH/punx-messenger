import 'dart:async';

import 'package:flutter/material.dart';

import '../../services/gif_service.dart';
import '../../theme/palette.dart';
import '../../theme/text_styles.dart';

/// The picked GIF, or null if dismissed.
///
/// Port of `components/GifPanel.jsx`. Picking sends immediately rather than
/// inserting into the composer — the web does the same, because a GIF is the
/// whole message, not text you go on editing.
Future<GifItem?> showGifPickerSheet(BuildContext context) {
  return showModalBottomSheet<GifItem>(
    context: context,
    backgroundColor: Palette.bgRaised,
    isScrollControlled: true,
    builder: (_) => const _GifPickerSheet(),
  );
}

class _GifPickerSheet extends StatefulWidget {
  const _GifPickerSheet();

  @override
  State<_GifPickerSheet> createState() => _GifPickerSheetState();
}

class _GifPickerSheetState extends State<_GifPickerSheet> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<GifItem> _items = const [];
  bool _loading = true;
  String? _error;

  /// Guards against an earlier, slower request overwriting a newer one's
  /// results — the web uses a `cancelled` flag in its effect for this.
  int _requestId = 0;

  @override
  void initState() {
    super.initState();
    _load('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _load(String query) async {
    final id = ++_requestId;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = query.trim().isEmpty
          ? await GifService.trending()
          : await GifService.search(query.trim());
      if (!mounted || id != _requestId) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || id != _requestId) return;
      setState(() {
        _error = 'Could not load GIFs. $e';
        _loading = false;
      });
    }
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    // 350ms while typing, immediate when cleared back to trending — the same
    // cadence as the web, so search doesn't fire per keystroke.
    _debounce = Timer(
      value.trim().isEmpty ? Duration.zero : const Duration(milliseconds: 350),
      () => _load(value),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Sized against the viewport so the grid keeps its shape whether or not
    // the keyboard is up.
    final height = MediaQuery.sizeOf(context).height * 0.6;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SizedBox(
          height: height,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: TextField(
                  controller: _controller,
                  onChanged: _onQueryChanged,
                  autofocus: false,
                  style: AppTextStyles.sm(),
                  decoration: InputDecoration(
                    hintText: 'Search GIFs',
                    hintStyle: AppTextStyles.sm(color: Palette.inkMuted),
                    prefixIcon: const Icon(Icons.search, size: 18),
                    isDense: true,
                    filled: true,
                    fillColor: Palette.bgDark,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
              Expanded(child: _body()),
              // Klipy's terms require visible attribution wherever results are
              // shown, same as the web panel's footer.
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  'Powered by Klipy',
                  style: AppTextStyles.xs(color: Palette.inkMuted),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _error!,
            textAlign: TextAlign.center,
            style: AppTextStyles.sm(color: Palette.bad),
          ),
        ),
      );
    }
    if (_items.isEmpty) {
      return Center(
        child: Text(
          'No GIFs found.',
          style: AppTextStyles.sm(color: Palette.inkMuted),
        ),
      );
    }
    return GridView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 6,
        crossAxisSpacing: 6,
      ),
      itemCount: _items.length,
      itemBuilder: (_, i) {
        final g = _items[i];
        return InkWell(
          onTap: () => Navigator.of(context).pop(g),
          borderRadius: BorderRadius.circular(8),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(
              g.thumbUrl!,
              fit: BoxFit.cover,
              // A dead thumbnail must not take the grid down with it.
              errorBuilder: (_, _, _) => Container(
                color: Palette.bgDark,
                child: const Center(
                  child: Icon(Icons.broken_image, size: 18, color: Palette.inkMuted),
                ),
              ),
              loadingBuilder: (_, child, progress) =>
                  progress == null ? child : Container(color: Palette.bgDark),
            ),
          ),
        );
      },
    );
  }
}
