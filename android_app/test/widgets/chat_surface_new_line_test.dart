import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// ChatSurface needs live Firestore listeners, so its "New" line decision is
// guarded here by reading the source, as tests/new-line.test.mjs does for the
// web app. The behaviour of the line itself is exercised for real in
// message_list_test.dart.
String _read(String path) =>
    File(path).readAsStringSync().replaceAll('\r\n', '\n');

void main() {
  final surface = _read('lib/widgets/chat/chat_surface.dart');

  test('the line is decided once per opening, from the first messages', () {
    expect(
      surface,
      contains(
        'if (!_newDecided && messages.isNotEmpty && containerPath != null)',
      ),
    );
    expect(surface, contains('_newDecided = true;'));
    expect(surface, contains('_newFromId = firstUnreadId('));
  });

  test(
    'it uses the last-read time taken when the chat was opened, not later',
    () {
      // Matched loosely: dart format wraps this expression across lines.
      expect(
        surface,
        matches(RegExp(r'_readAtEntry\.known\s*\?\s*_readAtEntry\.at\s*:')),
      );
      expect(
        surface,
        matches(RegExp(r'at:[\s\S]*?\.lastRead\[\s*pathToReadKey\(')),
        reason: 'the time is read from your own profile when the chat opens',
      );
      // Captured in initState, before the mark-read timer (400 ms) can fire.
      final init = surface.indexOf('_captureOpening();');
      final markRead = surface.indexOf('.markRead();');
      expect(init, greaterThan(0));
      expect(markRead, greaterThan(init));
    },
  );

  test(
    'pointing the surface at another conversation decides the line afresh',
    () {
      expect(
        surface,
        contains('if (widget.path != oldWidget.path) _captureOpening();'),
      );
      expect(surface, contains('_newDecided = false;\n    _newFromId = null;'));
    },
  );

  test('private notes have no line, and the list is told where it is', () {
    expect(surface, contains("widget.path.startsWith('users/')"));
    expect(surface, contains('newFromId: _newFromId,'));
  });

  test(
    'a user directory that had not arrived at opening falls back to the current times',
    () {
      expect(surface, contains('if (_readAtEntry.known || me != null)'));
    },
  );
}
