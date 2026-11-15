import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/utils/copy_text.dart';

ChatMessage _m(String text, {String? imageURL, Object? audioURL}) =>
    ChatMessage.fromMap('m1', {
      'text': text,
      'imageURL': imageURL,
      'audioURL': audioURL,
      'author': {'uid': 'ana', 'name': 'Ana'},
    });

UserProfile _u(String id, String name) => UserProfile.fromMap(id, {'name': name, 'email': '$id@x.test'});

void main() {
  group('hasCopyableText', () {
    test('text can be copied; a picture, a voice message or blank text cannot', () {
      expect(hasCopyableText(_m('hi')), isTrue);
      expect(hasCopyableText(_m('')), isFalse);
      expect(hasCopyableText(_m('   \n ')), isFalse);
      expect(hasCopyableText(_m('', imageURL: 'data:image/png;base64,AA')), isFalse);
      expect(hasCopyableText(_m('', audioURL: 'data:audio/mp4;base64,AAAA')), isFalse);
      expect(hasCopyableText(_m('look', imageURL: 'data:image/png;base64,AA')), isTrue);
    });
  });

  group('copyableText', () {
    test('plain text comes back as written, with its formatting marks, trimmed', () {
      expect(copyableText(_m('  **bold** and `code`\nnext line  '), {}), '**bold** and `code`\nnext line');
    });

    test('a mention is written as @Name, with the name trimmed', () {
      final users = {'cara123': _u('cara123', '  Cara Diaz ')};
      expect(copyableText(_m('hi <@cara123>, see this'), users), 'hi @Cara Diaz, see this');
    });

    test('every mention in the text is turned back, not just the first', () {
      final users = {'cara123': _u('cara123', 'Cara'), 'ben4567': _u('ben4567', 'Ben')};
      expect(copyableText(_m('<@cara123> and <@ben4567> and <@cara123>'), users), '@Cara and @Ben and @Cara');
    });

    test('a person who is not in the directory, or has no name, is @Unknown', () {
      expect(copyableText(_m('hi <@gone1234>'), {}), 'hi $unknownMention');
      expect(unknownMention, '@Unknown');
      final blank = {'gone1234': _u('gone1234', '   ')};
      expect(copyableText(_m('hi <@gone1234>'), blank), 'hi @Unknown');
    });

    test('only a real mention token is replaced', () {
      final users = {'cara123': _u('cara123', 'Cara')};
      expect(copyableText(_m('<@short> <@cara123 x> @cara123'), users), '<@short> <@cara123 x> @cara123');
    });

    test('a message with nothing to copy copies nothing', () {
      expect(copyableText(_m('', imageURL: 'data:image/png;base64,AA'), {}), '');
      expect(copyableText(_m('  '), {}), '');
    });
  });
}
