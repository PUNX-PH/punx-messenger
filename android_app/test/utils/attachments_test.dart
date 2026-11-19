import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/utils/attachments.dart';

Attachment pic(String name, [int size = 10]) =>
    Attachment(bytes: Uint8List(size), name: name);

List<String> names(Iterable<Attachment> l) => l.map((a) => a.name).toList();

void main() {
  test('the limits are the web\'s', () {
    expect(maxAttachments, 10);
    expect(maxAttachmentBytes, 10 * 1024 * 1024);
  });

  group('adding pictures', () {
    test('what was there, then what came in, in order', () {
      final r = addAttachments([pic('a')], [pic('b'), pic('c')]);
      expect(names(r.files), ['a', 'b', 'c']);
      expect(r.problem, isNull);
    });

    test('nothing coming in changes nothing', () {
      final r = addAttachments([pic('a')], const []);
      expect(names(r.files), ['a']);
      expect(r.problem, isNull);
      expect(addAttachments(const [], const []).files, isEmpty);
    });

    test('the same picture chosen twice is one: same name and size', () {
      final r = addAttachments([pic('a', 5)], [pic('a', 5), pic('b')]);
      expect(names(r.files), ['a', 'b']);
      expect(r.problem, isNull, reason: 'not a problem, just not added twice');
    });

    test('the same name with another size is another picture, and so is the same size with another name', () {
      expect(names(addAttachments([pic('a', 5)], [pic('a', 6)]).files), ['a', 'a']);
      expect(names(addAttachments([pic('a', 5)], [pic('b', 5)]).files), ['a', 'b']);
    });

    test('the same picture twice in one go is one', () {
      expect(names(addAttachments(const [], [pic('a'), pic('a')]).files), ['a']);
    });

    test('a picture over 10 MB is left out, and says so; exactly 10 MB is fine', () {
      final r = addAttachments(const [], [pic('ok', maxAttachmentBytes), pic('big', maxAttachmentBytes + 1)]);
      expect(names(r.files), ['ok']);
      expect(r.problem, '1 image is over 10 MB.');
    });

    test('several too big, in the plural', () {
      final r = addAttachments(const [], [pic('x', maxAttachmentBytes + 1), pic('y', maxAttachmentBytes + 1), pic('z')]);
      expect(names(r.files), ['z']);
      expect(r.problem, '2 images are over 10 MB.');
    });

    test('ten at most; the rest are left out, and say so', () {
      final r = addAttachments(const [], [for (var i = 0; i < 12; i++) pic('p$i')]);
      expect(names(r.files), [for (var i = 0; i < 10; i++) 'p$i'], reason: 'the first ten, in order');
      expect(r.problem, '2 images left out: at most 10 at a time.');
    });

    test('one too many, in the singular', () {
      final r = addAttachments([for (var i = 0; i < 10; i++) pic('p$i')], [pic('extra')]);
      expect(r.files, hasLength(10));
      expect(r.problem, '1 image left out: at most 10 at a time.');
    });

    test('exactly ten fit', () {
      final r = addAttachments(const [], [for (var i = 0; i < 10; i++) pic('p$i')]);
      expect(r.files, hasLength(10));
      expect(r.problem, isNull);
    });

    test('nothing already there is ever dropped, and a bad picture never takes a place', () {
      final have = [for (var i = 0; i < 9; i++) pic('p$i')];
      final r = addAttachments(have, [pic('big', maxAttachmentBytes + 1), pic('last'), pic('over')]);
      expect(names(r.files), [...names(have), 'last'], reason: 'the oversize one did not use the tenth place');
      expect(r.problem, '1 image is over 10 MB; 1 image left out: at most 10 at a time.');
    });

    test('a duplicate of one already there, with the list full, is not "left out": it is not a new picture', () {
      final have = [for (var i = 0; i < 10; i++) pic('p$i')];
      final r = addAttachments(have, [pic('p3')]);
      expect(r.files, hasLength(10));
      expect(r.problem, isNull);
    });

    test('a picture too big, with the list full, is "too big", not "left out"', () {
      final have = [for (var i = 0; i < 10; i++) pic('p$i')];
      final r = addAttachments(have, [pic('huge', maxAttachmentBytes + 1)]);
      expect(r.problem, '1 image is over 10 MB.');
    });

    test('a duplicate does not use a place either', () {
      final have = [for (var i = 0; i < 9; i++) pic('p$i')];
      final r = addAttachments(have, [pic('p0'), pic('last')]);
      expect(r.files, hasLength(10));
      expect(r.problem, isNull);
    });

    test('the list it was given is left alone', () {
      final have = [pic('a')];
      addAttachments(have, [pic('b')]);
      expect(names(have), ['a']);
    });
  });

  group('sending them', () {
    /// A send that records what it was asked, and fails on the call numbers in [failOn] (0-based).
    ({AttachmentSend send, List<({String text, String? file})> calls}) recorder({Set<int> failOn = const {}}) {
      final calls = <({String text, String? file})>[];
      return (
        calls: calls,
        send: ({required text, file}) async {
          final n = calls.length;
          calls.add((text: text, file: file?.name));
          if (failOn.contains(n)) throw StateError('boom $n');
        },
      );
    }

    test('nothing attached: one message with the text', () async {
      final r = recorder();
      final out = await sendAttachments(text: 'hi', files: const [], send: r.send);
      expect(out.sent, 1);
      expect(out.error, isNull);
      expect(r.calls, [(text: 'hi', file: null)]);
    });

    test('nothing attached and a failure: nothing went', () async {
      final r = recorder(failOn: {0});
      final out = await sendAttachments(text: 'hi', files: const [], send: r.send);
      expect(out.sent, 0);
      expect(out.error, isA<StateError>());
    });

    test('pictures: one message each, in order, and the text rides on the first only', () async {
      final r = recorder();
      final out = await sendAttachments(text: 'look', files: [pic('a'), pic('b'), pic('c')], send: r.send);
      expect(out.sent, 3);
      expect(out.error, isNull);
      expect(r.calls, [(text: 'look', file: 'a'), (text: '', file: 'b'), (text: '', file: 'c')]);
    });

    test('one picture and no words is one message without text', () async {
      final r = recorder();
      await sendAttachments(text: '', files: [pic('a')], send: r.send);
      expect(r.calls, [(text: '', file: 'a')]);
    });

    test('they go one at a time: the next is not started until the last has finished', () async {
      final log = <String>[];
      await sendAttachments(
        text: '',
        files: [pic('a'), pic('b')],
        send: ({required text, file}) async {
          log.add('start ${file!.name}');
          await Future<void>.delayed(const Duration(milliseconds: 5));
          log.add('end ${file.name}');
        },
      );
      expect(log, ['start a', 'end a', 'start b', 'end b']);
    });

    test('it stops at the first failure and says how far it got', () async {
      final r = recorder(failOn: {1});
      final out = await sendAttachments(text: 'look', files: [pic('a'), pic('b'), pic('c')], send: r.send);
      expect(out.sent, 1);
      expect(out.error, isA<StateError>());
      expect(r.calls.map((c) => c.file), ['a', 'b'], reason: 'c was never tried');
    });

    test('a failure on the first one: nothing went', () async {
      final r = recorder(failOn: {0});
      final out = await sendAttachments(text: 'look', files: [pic('a'), pic('b')], send: r.send);
      expect(out.sent, 0);
      expect(r.calls, hasLength(1));
    });

    test('a failure on the last one', () async {
      final r = recorder(failOn: {2});
      final out = await sendAttachments(text: '', files: [pic('a'), pic('b'), pic('c')], send: r.send);
      expect(out.sent, 2);
    });

    test('progress is told before each message goes', () async {
      final seen = <String>[];
      final r = recorder();
      await sendAttachments(
        text: '',
        files: [pic('a'), pic('b'), pic('c')],
        send: ({required text, file}) {
          seen.add('send ${file!.name}');
          return r.send(text: text, file: file);
        },
        onProgress: (done, total) => seen.add('progress $done/$total'),
      );
      expect(seen, ['progress 0/3', 'send a', 'progress 1/3', 'send b', 'progress 2/3', 'send c']);
    });

    test('no progress for a message of words only', () async {
      var told = 0;
      await sendAttachments(text: 'hi', files: const [], send: recorder().send, onProgress: (_, _) => told++);
      expect(told, 0);
    });
  });

  group('what is left after a failure', () {
    test('the rest, in order', () {
      final files = [pic('a'), pic('b'), pic('c')];
      expect(names(remainingAfter(files, 1)), ['b', 'c']);
      expect(names(remainingAfter(files, 0)), ['a', 'b', 'c']);
      expect(remainingAfter(files, 3), isEmpty);
      expect(remainingAfter(files, 9), isEmpty);
      expect(names(remainingAfter(files, -1)), ['a', 'b', 'c']);
    });
  });

  test('the words while sending', () {
    expect(uploadingText(0, 1), 'Uploading…');
    expect(uploadingText(0, 0), 'Uploading…');
    expect(uploadingText(0, 5), 'Uploading 1 of 5…');
    expect(uploadingText(1, 5), 'Uploading 2 of 5…');
    expect(uploadingText(4, 5), 'Uploading 5 of 5…');
    expect(uploadingText(9, 5), 'Uploading 5 of 5…', reason: 'never past the end');
  });
}
