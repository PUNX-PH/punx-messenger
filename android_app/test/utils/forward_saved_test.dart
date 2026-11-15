import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/forwarded_from.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/utils/forward.dart';
import 'package:punx_messenger/utils/saved.dart';

const _voice = 'data:audio/mp4;base64,AAAA';
const _img = 'data:image/png;base64,AA';

ChatMessage _m({
  String id = 'm1',
  String text = '',
  String? imageURL,
  Object? audioURL,
  Object? audioMeta,
  Object? forwardedFrom,
  Object? savedFrom,
  Map<String, Object?>? imageMeta,
  Map<String, Object?> author = const {'uid': 'ana', 'name': 'Ana'},
}) => ChatMessage.fromMap(id, {
  'text': text,
  'imageURL': imageURL,
  'imageMeta': imageMeta,
  'audioURL': audioURL,
  'audioMeta': audioMeta,
  'forwardedFrom': forwardedFrom,
  'savedFrom': savedFrom,
  'author': author,
  'reactions': {'👍': ['x']},
  'pinned': true,
  'replyTo': {'messageId': 'r', 'authorUid': 'b', 'authorName': 'B', 'snippet': 's'},
});

UserProfile _u(String id, String name) =>
    UserProfile(id: id, email: '$id@x.test', name: name, role: Role.employee);

void main() {
  group('ForwardedFrom.parse', () {
    test('a name and a uid are read', () {
      final f = ForwardedFrom.parse({'uid': 'ana', 'name': 'Ana Reyes'})!;
      expect(f.name, 'Ana Reyes');
      expect(f.uid, 'ana');
    });

    test('the uid may be missing or not text', () {
      expect(ForwardedFrom.parse({'name': 'Ana'})!.uid, isNull);
      expect(ForwardedFrom.parse({'uid': 5, 'name': 'Ana'})!.uid, isNull);
    });

    test('the name is cleaned: one line, at most 60 characters', () {
      expect(ForwardedFrom.parse({'name': '  Ana\n  Reyes '})!.name, 'Ana Reyes');
      expect(ForwardedFrom.parse({'name': 'x' * 100})!.name.length, 60);
    });

    test('anything that is not an object with a usable name is none', () {
      for (final x in <Object?>[null, 'Ana', 5, <String>['Ana'], <String, Object?>{}, {'name': ''}, {'name': '   '}, {'name': 5}, {'uid': 'ana'}]) {
        expect(ForwardedFrom.parse(x), isNull, reason: '$x');
      }
    });

    test('it is written back as uid and name', () {
      expect(const ForwardedFrom(name: 'Ana', uid: 'a1').toMap(), {'uid': 'a1', 'name': 'Ana'});
      expect(const ForwardedFrom(name: 'Ana').toMap(), {'uid': null, 'name': 'Ana'});
    });
  });

  group('the message reads who it came from, and whether it is a saved copy', () {
    test('forwardedFrom and savedFrom', () {
      final m = _m(text: 'hi', forwardedFrom: {'uid': 'ana', 'name': 'Ana'}, savedFrom: {'route': null});
      expect(m.forwardedFrom?.name, 'Ana');
      expect(m.isSavedNote, isTrue);
    });

    test('an ordinary message is neither', () {
      final m = _m(text: 'hi');
      expect(m.forwardedFrom, isNull);
      expect(m.isSavedNote, isFalse);
    });

    test('savedFrom must be an object', () {
      for (final x in <Object?>['x', 5, true, <String>['a']]) {
        expect(_m(text: 'hi', savedFrom: x).isSavedNote, isFalse, reason: '$x');
      }
    });

    test('pinning one keeps both', () {
      final m = _m(text: 'hi', forwardedFrom: {'name': 'Ana'}, savedFrom: {});
      final p = m.copyWith(pinned: false);
      expect(p.forwardedFrom?.name, 'Ana');
      expect(p.isSavedNote, isTrue);
    });
  });

  group('canForward', () {
    test('text, a picture or a voice message can be passed on', () {
      expect(canForward(_m(text: 'hi')), isTrue);
      expect(canForward(_m(imageURL: _img)), isTrue);
      expect(canForward(_m(audioURL: _voice)), isTrue);
    });

    test('nothing, blank text, and a voice address that may not be played, cannot', () {
      expect(canForward(_m()), isFalse);
      expect(canForward(_m(text: '  \n')), isFalse);
      expect(canForward(_m(imageURL: '')), isFalse);
      expect(canForward(_m(audioURL: 'https://x.test/a.mp3')), isFalse);
    });
  });

  group('forwardPayload', () {
    test('nothing to pass on is null', () {
      expect(forwardPayload(_m(), {}), isNull);
    });

    test('the text, with mentions written as names, and who wrote it', () {
      final p = forwardPayload(_m(text: 'ask <@cara123>'), {'cara123': _u('cara123', 'Cara Diaz'), 'ana': _u('ana', 'Ana Reyes')})!;
      expect(p.text, 'ask @Cara Diaz');
      expect(p.forwardedFrom.uid, 'ana');
      expect(p.forwardedFrom.name, 'Ana Reyes', reason: 'their name as it is now');
      expect(p.imageURL, isNull);
      expect(p.imageMeta, isNull);
      expect(p.voice, isNull);
    });

    test('the name on the message is used when the directory does not know them', () {
      expect(forwardPayload(_m(text: 'hi'), {})!.forwardedFrom.name, 'Ana');
    });

    test('a blank name in the directory falls back to the one on the message', () {
      expect(forwardPayload(_m(text: 'hi'), {'ana': _u('ana', '')})!.forwardedFrom.name, 'Ana');
    });

    test('with no name anywhere it is Unknown', () {
      final p = forwardPayload(_m(text: 'hi', author: {'uid': 'ana', 'name': ''}), {})!;
      expect(p.forwardedFrom.name, 'Unknown');
      final blank = forwardPayload(_m(text: 'hi', author: {'uid': 'ana', 'name': '  '}), {})!;
      expect(blank.forwardedFrom.name, 'Unknown');
    });

    test('the writer\'s name is cleaned like any status', () {
      final p = forwardPayload(_m(text: 'hi'), {'ana': _u('ana', '  A\n${'n' * 80}')})!;
      expect(p.forwardedFrom.name.length, lessThanOrEqualTo(60));
      expect(p.forwardedFrom.name.contains('\n'), isFalse);
    });

    test('a picture comes with its details', () {
      final p = forwardPayload(_m(imageURL: _img, imageMeta: {'width': 3, 'height': 4, 'approxBytes': 5, 'originalName': 'a.png'}), {})!;
      expect(p.imageURL, _img);
      expect(p.imageMeta?.width, 3);
      expect(p.imageMeta?.originalName, 'a.png');
      expect(p.text, '');
    });

    test('an empty picture address is no picture, and details of a picture that is not there are not carried', () {
      final p = forwardPayload(
        _m(text: 'hi', imageURL: '', imageMeta: {'width': 3, 'height': 4, 'approxBytes': 5, 'originalName': 'a.png'}),
        {},
      )!;
      expect(p.imageURL, isNull);
      expect(p.imageMeta, isNull);
      final v = forwardPayload(
        _m(audioURL: _voice, imageMeta: {'width': 3, 'height': 4, 'approxBytes': 5, 'originalName': 'a.png'}),
        {},
      )!;
      expect(v.imageMeta, isNull);
      expect(v.imageURL, isNull);
    });

    test('a voice message comes with its length and type', () {
      final p = forwardPayload(_m(audioURL: _voice, audioMeta: {'durationMs': 7400, 'mime': 'audio/mp4'}), {})!;
      expect(p.voice?.dataUrl, _voice);
      expect(p.voice?.durationMs, 7400);
      expect(p.voice?.storedMime, 'audio/mp4');
    });

    test('a voice message with no type stored has none', () {
      final p = forwardPayload(_m(audioURL: _voice, audioMeta: {'durationMs': 7400}), {})!;
      expect(p.voice?.storedMime, isNull);
      expect(forwardPayload(_m(audioURL: _voice, audioMeta: {'mime': 5}), {})!.voice?.storedMime, isNull);
    });

    test('one that was itself forwarded keeps its ORIGINAL writer, not the one who passed it on', () {
      final p = forwardPayload(_m(text: 'hi', forwardedFrom: {'uid': 'dan', 'name': 'Dan Cruz'}), {'ana': _u('ana', 'Ana Reyes')})!;
      expect(p.forwardedFrom.name, 'Dan Cruz');
      expect(p.forwardedFrom.uid, 'dan');
    });
  });

  group('savedNoteId', () {
    test('is the message id with a prefix, so saving twice is one note', () {
      expect(savedNoteId('abc123'), 's_abc123');
      expect(savedNoteId('A-b_9'), 's_A-b_9');
      expect(savedNoteId('x' * 64), 's_${'x' * 64}');
    });

    test('an id that cannot be a document id is none', () {
      for (final id in ['', 'a/b', 'a b', 'a.b', 'x' * 65, 'a\n']) {
        expect(savedNoteId(id), isNull, reason: id);
      }
    });
  });

  group('originalRoute', () {
    test('a channel message has the web\'s address, so the web can follow it from a note saved here', () {
      expect(originalRoute('groups/g1/channels/c1/messages', 'm1'), '/g/g1/c/c1?m=m1');
    });

    test('anything else has none: a DM, a note, a path that is not a messages collection', () {
      for (final path in ['dms/a__b/messages', 'users/u/notes', 'groups/g1/channels/c1', 'groups/g1/channels/c1/messages/extra', 'groups/g 1/channels/c1/messages', 'x/groups/g1/channels/c1/messages', '']) {
        expect(originalRoute(path, 'm1'), isNull, reason: path);
      }
    });

    test('a message id that cannot be put in an address gives none', () {
      expect(originalRoute('groups/g1/channels/c1/messages', 'a b'), isNull);
      expect(originalRoute('groups/g1/channels/c1/messages', ''), isNull);
    });
  });

  group('savedPayload', () {
    test('the same copy a forward makes, and where it was saved from', () {
      final p = savedPayload(_m(text: 'hi'), {}, 'groups/g1/channels/c1/messages')!;
      expect(p.copy.text, 'hi');
      expect(p.copy.forwardedFrom.name, 'Ana');
      expect(p.route, '/g/g1/c/c1?m=m1');
    });

    test('a DM message has no way back', () {
      expect(savedPayload(_m(text: 'hi'), {}, 'dms/a__b/messages')!.route, isNull);
    });

    test('nothing to save is null', () {
      expect(savedPayload(_m(), {}, 'groups/g1/channels/c1/messages'), isNull);
    });
  });
}
