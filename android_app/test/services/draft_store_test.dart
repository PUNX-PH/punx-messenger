import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/services/draft_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<DraftStore> open([Map<String, Object> initial = const {}]) async {
  SharedPreferences.setMockInitialValues(initial);
  final prefs = await SharedPreferences.getInstance();
  return DraftStore(prefs, saveDelay: Duration.zero);
}

/// A second store reading what the first one wrote (an app restart).
Future<DraftStore> reopen() async {
  final prefs = await SharedPreferences.getInstance();
  return DraftStore(prefs, saveDelay: Duration.zero);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a conversation nobody typed in has no draft', () async {
    final s = await open();
    expect(s.get('me:dms/a/messages'), '');
    expect(s.get(null), '');
  });

  test('what you type is kept and comes back', () async {
    final s = await open();
    s.set('k', 'half a thought');
    expect(s.get('k'), 'half a thought');
  });

  test('drafts belong to their own conversation and account', () async {
    final s = await open();
    s.set('ana:groups/g/channels/A/messages', 'for A');
    expect(s.get('ana:groups/g/channels/B/messages'), '');
    expect(s.get('ben:groups/g/channels/A/messages'), '');
    s.set('ana:groups/g/channels/B/messages', 'for B');
    expect(s.get('ana:groups/g/channels/A/messages'), 'for A');
  });

  test('emptying the box, or only spaces, removes the draft', () async {
    final s = await open();
    s.set('k', 'text');
    s.set('k', '');
    expect(s.get('k'), '');
    s.set('k', 'text');
    s.set('k', '   \n ');
    expect(s.get('k'), '');
  });

  test('a null key does nothing and does not throw', () async {
    final s = await open();
    expect(() {
      s.set(null, 'x');
      s.clear(null);
    }, returnsNormally);
    expect(s.get(null), '');
  });

  test('only the 50 most recently touched are kept', () async {
    final s = await open();
    for (var i = 1; i <= 50; i++) {
      s.set('k$i', 'text $i');
    }
    s.set('k1', 'k1 touched again'); // now the newest, so k2 is the oldest
    s.set('k51', 'one more');
    expect(s.get('k2'), '', reason: 'the oldest-touched is dropped');
    expect(s.get('k1'), 'k1 touched again');
    expect(s.get('k51'), 'one more');
    expect(s.get('k50'), 'text 50');
  });

  test('one runaway paste cannot fill storage', () async {
    final s = await open();
    s.set('k', 'x' * 100000);
    expect(s.get('k').length, DraftStore.maxChars);
  });

  test('drafts survive a restart', () async {
    final s = await open();
    s.set('me:dms/a/messages', 'keep me');
    await s.flush();
    final again = await reopen();
    expect(again.get('me:dms/a/messages'), 'keep me');
  });

  test(
    'a cleared draft (a message was sent) does not come back after a restart',
    () async {
      final s = await open();
      s.set('a', 'about to be sent');
      s.set('b', 'still unsent');
      await s.flush();
      s.clear('a');
      // No flush here: clearing must schedule its own write, or a sent message
      // comes back in the box after the app is restarted.
      await Future<void>.delayed(Duration.zero);
      final again = await reopen();
      expect(
        again.get('a'),
        '',
        reason: 'the sent message must not reappear in the box',
      );
      expect(again.get('b'), 'still unsent');
    },
  );

  test('signing out wipes every draft, from storage too', () async {
    final s = await open();
    s.set('ana:a', '1');
    s.set('ana:b', '2');
    await s.flush();
    await s.clearAll();
    expect(s.get('ana:a'), '');
    final again = await reopen();
    expect(again.get('ana:b'), '');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.containsKey('punx.drafts'), isFalse);
  });

  test('writes wait for a pause in typing, and flush writes at once', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final s = DraftStore(prefs, saveDelay: const Duration(milliseconds: 40));
    s.set('k', 'a');
    s.set('k', 'ab');
    s.set('k', 'abc');
    expect(
      prefs.getString('punx.drafts'),
      isNull,
      reason: 'not written on every keystroke',
    );
    await s.flush();
    expect((jsonDecode(prefs.getString('punx.drafts')!) as Map)['k'], 'abc');
    s.set('k', 'abcd');
    await Future<void>.delayed(const Duration(milliseconds: 120));
    expect((jsonDecode(prefs.getString('punx.drafts')!) as Map)['k'], 'abcd');
  });

  test('damaged storage starts empty instead of stopping the app', () async {
    for (final raw in ['not json', '[1,2]', '"x"', '123', 'null']) {
      final s = await open({'punx.drafts': raw});
      expect(s.get('a'), '', reason: raw);
    }
    final mixed = await open({
      'punx.drafts': '{"a":5,"b":"","c":"   ","d":"ok"}',
    });
    expect(mixed.get('d'), 'ok');
    expect(mixed.get('a'), '', reason: 'a non-text entry is ignored');
    expect(mixed.get('b'), '');
    expect(mixed.get('c'), '');
  });

  test('with no storage at all, drafts still work for the run', () {
    final s = DraftStore.inMemory();
    s.set('k', 'v');
    expect(s.get('k'), 'v');
  });
}
