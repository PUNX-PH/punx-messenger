import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/utils/search_filters.dart';
import 'package:punx_messenger/utils/search_people.dart';

// The person picker of the search box, as the web's (tests/search-people.test.mjs).

ChatMessage m(String uid, String name, {List<String> mentions = const []}) =>
    ChatMessage(
      id: 'm-$uid-${mentions.length}',
      author: MessageAuthor(uid: uid, name: name),
      text: 'hi',
      mentionedUids: mentions,
    );

UserProfile user(String id, String name) =>
    UserProfile(id: id, email: '$id@x.test', name: name, role: Role.employee);

final users = {
  'ana': user('ana', 'Ana Reyes'),
  'ben': user('ben', 'Ben Cruz'),
  'ian': user('ian', 'Ian Díaz'),
  'jose': user('jose', 'José Núñez'),
  'me': user('me', 'Rey'),
};

final people = [
  for (final uid in ['ana', 'ben', 'ian', 'jose'])
    (uid: uid, name: users[uid]!.name),
];

List<String> labels(List<PersonChoice> l) => [for (final p in l) p.label];

void main() {
  group('openPersonPiece', () {
    test(
      'a from: or mentions: at the end of the box is a piece being typed, with what is typed of the name',
      () {
        expect(openPersonPiece('from:'), (op: 'from', partial: '', start: 0));
        expect(openPersonPiece('from:an'), (
          op: 'from',
          partial: 'an',
          start: 0,
        ));
        expect(openPersonPiece('mentions:ju'), (
          op: 'mentions',
          partial: 'ju',
          start: 0,
        ));
        expect(openPersonPiece('release from:an'), (
          op: 'from',
          partial: 'an',
          start: 8,
        ));
        expect(openPersonPiece('has:image  from:'), (
          op: 'from',
          partial: '',
          start: 11,
        ));
      },
    );

    test(
      'capitals in the operator do not matter, and it is reported in lower case',
      () {
        expect(openPersonPiece('FROM:an'), (
          op: 'from',
          partial: 'an',
          start: 0,
        ));
        expect(openPersonPiece('Mentions:x')!.op, 'mentions');
      },
    );

    test(
      'a quote not closed yet is part of the piece, and the quote itself is not in what is typed',
      () {
        expect(openPersonPiece('from:"Ana R'), (
          op: 'from',
          partial: 'Ana R',
          start: 0,
        ));
        expect(openPersonPiece('x from:"'), (
          op: 'from',
          partial: '',
          start: 2,
        ));
      },
    );

    test(
      'a finished piece is not one being typed: a closing quote, a space after it, or another word after it',
      () {
        expect(openPersonPiece('from:"Ana Reyes"'), isNull);
        expect(openPersonPiece('from:ana '), isNull);
        expect(openPersonPiece('from:ana release'), isNull);
        expect(openPersonPiece('from:"Ana Reyes" has:'), isNull);
      },
    );

    test('only from: and mentions: have people', () {
      for (final q in [
        'has:',
        'has:im',
        'is:pin',
        'before:2026',
        'on:',
        '',
        'release',
        'xfrom:an',
        'https://from:x',
        'refrom:an',
        'a-from:an',
      ]) {
        expect(openPersonPiece(q), isNull, reason: q);
      }
      expect(openPersonPiece(null), isNull);
    });

    test(
      'the piece it finds is the one the search ignores while it is being typed',
      () {
        expect(parseSearch('from:').from, isEmpty);
      },
    );
  });

  group('chatPeople', () {
    test(
      'from: offers the authors, the one who wrote last first, each once',
      () {
        final ms = [
          m('ana', 'Ana'),
          m('ben', 'Ben'),
          m('ana', 'Ana'),
          m('ian', 'Ian'),
        ];
        expect(
          [for (final p in chatPeople(ms, users, 'from')) p.uid],
          ['ian', 'ana', 'ben'],
        );
      },
    );

    test(
      'the name is the live one, or the one written on the message for someone who has gone',
      () {
        final ms = [m('ana', 'Old Name'), m('gone', 'Gone Person')];
        expect(chatPeople(ms, users, 'from'), [
          (uid: 'gone', name: 'Gone Person'),
          (uid: 'ana', name: 'Ana Reyes'),
        ]);
      },
    );

    test(
      'an author who has gone is offered under the name on their newest message',
      () {
        final ms = [m('gone', 'Old Name'), m('gone', 'New Name')];
        expect(chatPeople(ms, const {}, 'from'), [
          (uid: 'gone', name: 'New Name'),
        ]);
      },
    );

    test(
      'mentions: offers the people mentioned, by their live name, and no author',
      () {
        final ms = [
          m('ben', 'Ben', mentions: ['ana', 'jose']),
          m('ian', 'Ian', mentions: ['ana', 'nobody']),
        ];
        expect(
          [for (final p in chatPeople(ms, users, 'mentions')) p.name],
          ['Ana Reyes', 'José Núñez'],
        );
      },
    );

    test('someone with no name is left out, and nothing throws', () {
      expect(
        chatPeople([m('x', ''), m('', 'No uid')], const {}, 'from'),
        isEmpty,
      );
      expect(chatPeople(const [], users, 'from'), isEmpty);
    });
  });

  group('suggestPeople', () {
    test(
      'nothing typed yet offers everyone, and "Me" first when you could be meant',
      () {
        final r = suggestPeople(
          (op: 'from', partial: '', start: 0),
          people,
          meUid: 'me',
        );
        expect(labels(r), [
          'Me',
          'Ana Reyes',
          'Ben Cruz',
          'Ian Díaz',
          'José Núñez',
        ]);
        expect(r[0], (value: 'me', label: 'Me', hint: 'you'));
        expect(
          labels(suggestPeople((op: 'from', partial: '', start: 0), people)),
          ['Ana Reyes', 'Ben Cruz', 'Ian Díaz', 'José Núñez'],
          reason: 'no "Me" without knowing who you are',
        );
      },
    );

    PersonPiece typed(String s) => (op: 'from', partial: s, start: 0);

    test(
      'what is typed narrows it, ignoring accents and capitals, typed with or without them',
      () {
        for (final q in ['jose', 'JOSÉ', 'NUNEZ', 'núñez']) {
          expect(labels(suggestPeople(typed(q), people)), [
            'José Núñez',
          ], reason: q);
        }
        expect(labels(suggestPeople(typed('DÍAZ'), people)), ['Ian Díaz']);
        expect(labels(suggestPeople(typed('zzz'), people)), isEmpty);
      },
    );

    test(
      'a name that starts a word is offered before one that only holds it inside',
      () {
        final ppl = [
          (uid: 'a', name: 'Marian Cole'),
          (uid: 'b', name: 'Ian Cruz'),
          (uid: 'c', name: 'Dan Fiann'),
        ];
        expect(labels(suggestPeople(typed('ian'), ppl)), [
          'Ian Cruz',
          'Marian Cole',
          'Dan Fiann',
        ]);
        expect(labels(suggestPeople(typed('ian c'), ppl)), [
          'Ian Cruz',
          'Marian Cole',
        ]);
        expect(labels(suggestPeople(typed('marian'), ppl)), ['Marian Cole']);
      },
    );

    test(
      'the order of the people is kept within each group (the last one to write first)',
      () {
        final ppl = [(uid: 'z', name: 'Zed Ana'), (uid: 'y', name: 'Yan Ana')];
        expect(labels(suggestPeople(typed('ana'), ppl)), [
          'Zed Ana',
          'Yan Ana',
        ]);
      },
    );

    test(
      '"Me" is offered for m, me, and not for other letters; and you are not also offered by name',
      () {
        for (final q in ['m', 'me', 'ME']) {
          expect(
            suggestPeople(typed(q), people, meUid: 'me').first.value,
            'me',
            reason: q,
          );
        }
        for (final q in ['b', 'e', 'mex']) {
          expect(
            suggestPeople(
              typed(q),
              people,
              meUid: 'me',
            ).any((p) => p.value == 'me'),
            isFalse,
            reason: q,
          );
        }
        final withMe = [...people, (uid: 'me', name: 'Rey')];
        expect(
          labels(suggestPeople(typed('rey'), withMe, meUid: 'me')),
          ['Ana Reyes'],
          reason: 'Rey is "Me", not a second entry',
        );
      },
    );

    test('at most six are offered, and a limit can be given', () {
      final many = [
        for (var i = 0; i < 20; i++) (uid: 'u$i', name: 'Person $i'),
      ];
      expect(suggestPeople(typed(''), many, meUid: 'me').length, 6);
      expect(suggestPeople(typed('person'), many).length, 6);
      expect(suggestPeople(typed('person'), many, limit: 3).length, 3);
    });

    test('nothing without a piece, and no people is no list', () {
      expect(suggestPeople(null, people), isEmpty);
      expect(suggestPeople(typed('a'), const []), isEmpty);
    });

    test(
      'a double quote in a name cannot be quoted, so it is dropped from the value (the label keeps it)',
      () {
        final r = suggestPeople(typed('dan'), [
          (uid: 'q', name: 'Dan "Dee" Cole'),
        ]);
        expect(r, [
          (value: 'Dan Dee Cole', label: 'Dan "Dee" Cole', hint: null),
        ]);
      },
    );
  });

  group('pickPerson', () {
    test(
      'a name with spaces is quoted, one without is not, and a space follows',
      () {
        expect(
          pickPerson('from:an', (
            op: 'from',
            partial: 'an',
            start: 0,
          ), 'Ana Reyes'),
          'from:"Ana Reyes" ',
        );
        expect(
          pickPerson('from:', (op: 'from', partial: '', start: 0), 'me'),
          'from:me ',
        );
        expect(
          pickPerson('from:b', (op: 'from', partial: 'b', start: 0), 'Ben'),
          'from:Ben ',
        );
      },
    );

    test('what came before stays, and the piece is replaced, not added to', () {
      const q = 'release has:image from:"Ana R';
      expect(
        pickPerson(q, openPersonPiece(q)!, 'Ana Reyes'),
        'release has:image from:"Ana Reyes" ',
      );
      expect(
        pickPerson('mentions:j', openPersonPiece('mentions:j')!, 'José Núñez'),
        'mentions:"José Núñez" ',
      );
    });

    test(
      'what is written is a finished piece, and the search finds that person',
      () {
        final q = pickPerson(
          'from:jo',
          openPersonPiece('from:jo')!,
          'José Núñez',
        );
        expect(openPersonPiece(q), isNull, reason: 'finished: no more offers');
        final p = parseSearch(q);
        expect(p.from, ['josé núñez']);
        expect(
          messageMatches(m('jose', 'José Núñez'), p, usersById: users),
          isTrue,
        );
        expect(
          messageMatches(m('ben', 'Ben Cruz'), p, usersById: users),
          isFalse,
        );
      },
    );

    test('a piece that is out of date for the text does not throw', () {
      expect(
        pickPerson('ab', (op: 'from', partial: '', start: 9), 'Ben'),
        'abfrom:Ben ',
      );
    });

    test('picking from a chat end to end: type, see the people, press one', () {
      final ms = [m('ben', 'Ben'), m('ana', 'Ana'), m('jose', 'José')];
      const typed = 'budget from:jo';
      final piece = openPersonPiece(typed)!;
      final offered = suggestPeople(
        piece,
        chatPeople(ms, users, piece.op),
        meUid: 'me',
      );
      expect(labels(offered), ['José Núñez']);
      expect(
        pickPerson(typed, piece, offered.first.value),
        'budget from:"José Núñez" ',
      );
    });
  });

  group('the sheet', () {
    String read(String f) =>
        File(f).readAsStringSync().replaceAll('\r\n', '\n');

    test(
      'offers the people while typing, as chips, and writes the piece (pinned against the source)',
      () {
        final s = read('lib/widgets/chat/search_sheet.dart');
        expect(s.contains("import '../../utils/search_people.dart';"), isTrue);
        expect(s.contains('final piece = openPersonPiece(_query);'), isTrue);
        expect(
          s.contains(
            'chatPeople(widget.messages, widget.usersById, piece.op),',
          ),
          isTrue,
        );
        expect(s.contains('meUid: widget.meUid,'), isTrue);
        expect(
          s.contains(
            'final next = pickPerson(_controller.text, piece, value);',
          ),
          isTrue,
        );
        expect(s.contains('onPressed: () => _pick(piece, p.value),'), isTrue);
        expect(s.contains('if (piece != null && people.isNotEmpty)'), isTrue);
      },
    );
  });
}
