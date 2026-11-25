import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/message.dart';
import 'package:punx_messenger/models/message_author.dart';
import 'package:punx_messenger/models/reply_snapshot.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/models/voice_clip.dart';
import 'package:punx_messenger/utils/constants.dart';
import 'package:punx_messenger/utils/search_filters.dart';

int at(int y, int mo, int d, [int h = 12, int mi = 0, int s = 0]) =>
    DateTime(y, mo, d, h, mi, s).millisecondsSinceEpoch;
Timestamp ts(int ms) => Timestamp.fromMillisecondsSinceEpoch(ms);

final voice = VoiceClip.fromFields('data:audio/webm;base64,AAAA', {'durationMs': 1000});

/// A message `id`. Anything not given is plain: not a reply, not pinned, sent on 10 Nov 2026 (or not
/// sent yet, with [pending]).
ChatMessage msg(
  String id, {
  String? text,
  String? uid,
  String? name,
  String? imageURL,
  bool withVoice = false,
  String? replyTo,
  bool pinned = false,
  bool edited = false,
  List<String> mentions = const [],
  int? created,
  bool pending = false,
}) => ChatMessage(
  id: id,
  author: MessageAuthor(uid: uid ?? 'u-$id', name: name ?? 'Name $id'),
  text: text ?? 'text $id',
  imageURL: imageURL,
  voice: withVoice ? voice : null,
  replyTo: replyTo == null
      ? null
      : ReplySnapshot(messageId: replyTo, authorName: 'A', snippet: 's'),
  pinned: pinned,
  editedAt: edited ? ts(5) : null,
  mentionedUids: mentions,
  createdAt: pending ? null : ts(created ?? at(2026, 11, 10)),
);

UserProfile user(String id, String name) =>
    UserProfile(id: id, email: '$id@x.test', name: name, role: Role.employee);

final users = {
  'ana': user('ana', 'Ana Reyes'),
  'ben': user('ben', 'Ben Cruz'),
  'me': user('me', 'Rey'),
};

bool run(ChatMessage m, String q, {String? meUid = 'me', Map<String, UserProfile>? usersById}) =>
    messageMatches(m, parseSearch(q), usersById: usersById ?? users, meUid: meUid);

List<String> ids(Iterable<ChatMessage> l) => l.map((m) => m.id).toList();

void main() {
  test('the voice message used below really is one', () {
    expect(voice, isNotNull);
  });

  test('the limits and the lists the box offers', () {
    expect(AppTiming.searchResultCap, 100);
    expect(hasValues, ['image', 'voice', 'link', 'reply']);
    expect(isValues, ['pinned', 'edited']);
    expect(searchChips.map((c) => c.token), ['has:image', 'has:voice', 'has:link', 'has:reply', 'is:pinned']);
    expect(searchChips.map((c) => c.label), ['Pictures', 'Voice', 'Links', 'Replies', 'Pinned']);
  });

  group('days', () {
    test('a day is written year-month-day, and must be a real day', () {
      expect(parseDay('2026-11-01'), DateTime(2026, 11, 1));
      expect(parseDay(' 2026-11-01 '), DateTime(2026, 11, 1), reason: 'spaces around are fine');
      expect(parseDay('2028-02-29'), DateTime(2028, 2, 29), reason: 'a leap day');
      for (final bad in <String?>[
        '0026-11-01', '2027-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-11-00',
        '2026-11-31', '2026-1-1', '26-11-01', 'banana', '', null, '2026/11/01', '2026-11-01T10:00',
      ]) {
        expect(parseDay(bad), isNull, reason: '$bad');
      }
    });

    test('the web\'s edge: year 100 is fine, 99 is not', () {
      expect(parseDay('0100-01-01'), isNotNull);
      expect(parseDay('0099-12-31'), isNull);
    });
  });

  group('taking a query apart', () {
    test('words only: collapsed and trimmed, no filters', () {
      final p = parseSearch('  hello    big   world ');
      expect(p.text, 'hello big world');
      expect(p.hasFilters, isFalse);
      expect(p.problems, isEmpty);
    });

    test('nothing is an empty search', () {
      for (final q in <String?>['', '   ', null]) {
        final p = parseSearch(q);
        expect(p.text, '');
        expect(p.hasFilters, isFalse);
      }
    });

    test('each filter is read, the rest is the words, wherever the filter stands', () {
      final p = parseSearch('hello from:ana world has:image');
      expect(p.text, 'hello world');
      expect(p.from, ['ana']);
      expect(p.has, ['image']);
    });

    test('filters are not case sensitive, and the value is kept in lower case', () {
      final p = parseSearch('FROM:Ana HAS:Image IS:Pinned');
      expect(p.from, ['ana']);
      expect(p.has, ['image']);
      expect(p.flags, ['pinned']);
    });

    test('a value in quotes may have spaces, and spaces just inside the quotes are not part of it', () {
      final p = parseSearch('from:"Ana Reyes" hi');
      expect(p.from, ['ana reyes']);
      expect(p.text, 'hi');
      expect(parseSearch('from:" ana "').from, ['ana']);
      expect(parseSearch('from:"   "').from, isEmpty, reason: 'only spaces is nothing yet');
    });

    test('words either side of a piece do not run together, and the piece can start or end the query', () {
      expect(parseSearch('a from:x b').text, 'a b');
      expect(parseSearch('from:x a b').text, 'a b');
      expect(parseSearch('a b from:x').text, 'a b');
      expect(parseSearch('a from:x b has:image c').text, 'a b c');
      expect(parseSearch('from:x').text, '');
    });

    test('it is a filter only at the start of a word: links and other words with a colon stay words', () {
      expect(parseSearch('see https://example.com/a').text, 'see https://example.com/a');
      expect(parseSearch('re:hello').text, 're:hello');
      expect(parseSearch('xfrom:ana').text, 'xfrom:ana');
      expect(parseSearch('info:x').text, 'info:x');
      expect(parseSearch('foo:bar').text, 'foo:bar', reason: 'an unknown filter is just words');
      expect(parseSearch('xfrom:ana').from, isEmpty);
    });

    test('"from:" with nothing after it yet is being typed: ignored, not searched for', () {
      final p = parseSearch('from:');
      expect(p.text, '');
      expect(p.from, isEmpty);
      expect(p.problems, isEmpty);
      final q = parseSearch('from: ana');
      expect(q.from, isEmpty);
      expect(q.text, 'ana');
      expect(parseSearch('from:""').from, isEmpty, reason: 'empty quotes too');
    });

    test('the same piece twice counts once; different people are both kept', () {
      expect(parseSearch('from:ana from:ANA').from, ['ana']);
      expect(parseSearch('from:ana from:ben').from, ['ana', 'ben']);
      expect(parseSearch('has:image has:image').has, ['image']);
      expect(parseSearch('is:pinned is:PINNED').flags, ['pinned']);
      expect(parseSearch('mentions:ana mentions:ben').mentions, ['ana', 'ben']);
    });

    test('has: and is: take only what they know; the rest is a problem, not a word', () {
      final p = parseSearch('has:banana is:funny hi');
      expect(p.has, isEmpty);
      expect(p.flags, isEmpty);
      expect(p.text, 'hi', reason: 'the bad pieces are not searched for as words');
      expect(p.problems, hasLength(2));
      expect(p.problems[0], contains('has:banana'));
      expect(p.problems[0], contains('image, voice, link, reply'));
      expect(p.problems[1], contains('is:funny'));
      expect(p.problems[1], contains('pinned, edited'));
      expect(p.hasFilters, isFalse, reason: 'so nothing is filtered by them');
    });

    test('every value of has: and is: is accepted', () {
      expect(parseSearch(hasValues.map((v) => 'has:$v').join(' ')).has, hasValues);
      expect(parseSearch(isValues.map((v) => 'is:$v').join(' ')).flags, isValues);
    });

    test('days: before, after, on', () {
      final p = parseSearch('before:2026-11-05 after:2026-10-01 on:2026-11-02');
      expect(p.before, DateTime(2026, 11, 5));
      expect(p.after, DateTime(2026, 10, 1));
      expect(p.on, DateTime(2026, 11, 2));
      expect(p.problems, isEmpty);
      expect(p.text, '');
    });

    test('a day that is not a day is a problem, and is not applied', () {
      for (final op in ['before', 'after', 'on']) {
        final p = parseSearch('$op:2026-13-45 hi');
        expect(switch (op) { 'before' => p.before, 'after' => p.after, _ => p.on }, isNull, reason: op);
        expect(p.problems, hasLength(1), reason: op);
        expect(p.problems[0], contains('$op:2026-13-45'), reason: op);
        expect(p.problems[0], contains('2026-11-01'), reason: 'says how to write it');
        expect(p.text, 'hi');
      }
    });

    test('a day given twice: the last one stands', () {
      expect(parseSearch('before:2026-01-01 before:2026-02-01').before, DateTime(2026, 2, 1));
    });

    test('hasFilters is true for each kind of filter on its own', () {
      for (final q in ['from:a', 'mentions:a', 'has:image', 'is:pinned', 'before:2026-01-01', 'after:2026-01-01', 'on:2026-01-01']) {
        expect(parseSearch(q).hasFilters, isTrue, reason: q);
      }
    });
  });

  group('words', () {
    test('are looked for anywhere in the text, in any case', () {
      final m = msg('1', text: 'The Release Notes');
      expect(run(m, 'release'), isTrue);
      expect(run(m, 'NOTES'), isTrue);
      expect(run(m, 'release notes'), isTrue);
      expect(run(m, 'notes release'), isFalse, reason: 'as one phrase, in order');
      expect(run(m, 'banana'), isFalse);
      expect(run(msg('2', text: ''), 'x'), isFalse);
    });
  });

  group('from', () {
    test('matches the name as it is now, else the name the message carries', () {
      final m = msg('1', uid: 'ana', name: 'Old Name');
      expect(run(m, 'from:ana'), isTrue, reason: 'the live name Ana Reyes');
      expect(run(m, 'from:reyes'), isTrue, reason: 'any part of it');
      expect(run(m, 'from:old'), isFalse, reason: 'not the old name while the live one is known');
      expect(run(msg('2', uid: 'nobody', name: 'Gone Person'), 'from:gone'), isTrue, reason: 'a removed person still matches by the name on the message');
    });

    test('with a name that has spaces, in quotes', () {
      expect(run(msg('1', uid: 'ana'), 'from:"ana reyes"'), isTrue);
      expect(run(msg('1', uid: 'ana'), 'from:"reyes ana"'), isFalse);
    });

    test('two people is either of them', () {
      final a = msg('a', uid: 'ana');
      final b = msg('b', uid: 'ben');
      final c = msg('c', uid: 'me');
      expect(ids([a, b, c].where((m) => run(m, 'from:ana from:ben'))), ['a', 'b']);
    });

    test('from:me is you, by who you are and not by a name', () {
      expect(run(msg('1', uid: 'me'), 'from:me'), isTrue);
      expect(run(msg('1', uid: 'ana'), 'from:me'), isFalse);
      expect(run(msg('1', uid: 'me'), 'from:ME'), isTrue);
      expect(run(msg('1', uid: 'me'), 'from:me', meUid: null), isFalse, reason: 'nobody known to be you: nothing is "from me"');
      expect(run(msg('1', uid: '', name: 'Me'), 'from:me', meUid: ''), isFalse, reason: 'two blanks are not the same person');
    });

    test('a name that is empty falls back to the one on the message', () {
      final m = msg('1', uid: 'x', name: 'Carry');
      expect(run(m, 'from:carry', usersById: {'x': user('x', '')}), isTrue);
    });
  });

  group('mentions', () {
    test('finds a message that mentions that person', () {
      final m = msg('1', mentions: ['ben']);
      expect(run(m, 'mentions:ben'), isTrue);
      expect(run(m, 'mentions:cruz'), isTrue, reason: 'any part of the name');
      expect(run(m, 'mentions:ana'), isFalse);
      expect(run(msg('2'), 'mentions:ben'), isFalse, reason: 'no list at all');
      expect(run(msg('4', mentions: ['stranger']), 'mentions:stranger'), isFalse, reason: 'a person who is not known has no name to match');
    });

    test('two people is either', () {
      expect(run(msg('1', mentions: ['ben']), 'mentions:ana mentions:ben'), isTrue);
      expect(run(msg('1', mentions: ['ben']), 'mentions:ana mentions:me'), isFalse);
    });

    test('mentions:me is you', () {
      expect(run(msg('1', mentions: ['me']), 'mentions:me'), isTrue);
      expect(run(msg('1', mentions: ['ben']), 'mentions:me'), isFalse);
      expect(run(msg('1', mentions: ['me']), 'mentions:me', meUid: null), isFalse);
      expect(run(msg('1', mentions: ['']), 'mentions:me', meUid: ''), isFalse);
    });
  });

  group('has and is', () {
    test('has:image, has:voice', () {
      expect(run(msg('1', imageURL: 'data:image/png;base64,AAAA'), 'has:image'), isTrue);
      expect(run(msg('1', imageURL: 'https://gifs.example/x.gif'), 'has:image'), isTrue, reason: 'a GIF too');
      expect(run(msg('1'), 'has:image'), isFalse);
      expect(run(msg('1', withVoice: true), 'has:voice'), isTrue);
      expect(run(msg('1'), 'has:voice'), isFalse);
      expect(run(msg('1', imageURL: 'x'), 'has:voice'), isFalse, reason: 'a picture is not a voice message');
      expect(run(msg('1', withVoice: true), 'has:image'), isFalse, reason: 'nor the other way round');
    });

    test('has:link finds http and https addresses, and not words that only look like one', () {
      expect(run(msg('1', text: 'see https://example.com/a?b=1'), 'has:link'), isTrue);
      expect(run(msg('1', text: 'old http://example.com'), 'has:link'), isTrue);
      expect(run(msg('1', text: 'HTTPS://EXAMPLE.COM'), 'has:link'), isTrue);
      expect(run(msg('1', text: 'example.com'), 'has:link'), isFalse);
      expect(run(msg('1', text: 'httpx://nope'), 'has:link'), isFalse);
      expect(run(msg('1', text: 'https:// '), 'has:link'), isFalse, reason: 'no address after it');
    });

    test('has:reply finds a reply', () {
      expect(run(msg('1', replyTo: 'a'), 'has:reply'), isTrue);
      expect(run(msg('1'), 'has:reply'), isFalse);
      expect(run(msg('1', replyTo: ''), 'has:reply'), isFalse, reason: 'a quote with no id');
    });

    test('several has: all have to hold', () {
      expect(run(msg('1', imageURL: 'x', text: 'https://a.b'), 'has:image has:link'), isTrue);
      expect(run(msg('2', imageURL: 'x'), 'has:image has:link'), isFalse);
      expect(run(msg('3', text: 'https://a.b'), 'has:image has:link'), isFalse);
    });

    test('is:pinned and is:edited', () {
      expect(run(msg('1', pinned: true), 'is:pinned'), isTrue);
      expect(run(msg('1'), 'is:pinned'), isFalse);
      expect(run(msg('1', edited: true), 'is:edited'), isTrue);
      expect(run(msg('1'), 'is:edited'), isFalse);
      expect(run(msg('1', pinned: true), 'is:pinned is:edited'), isFalse, reason: 'both have to hold');
      expect(run(msg('1', pinned: true), 'is:edited'), isFalse, reason: 'pinned is not edited');
      expect(run(msg('1', edited: true), 'is:pinned'), isFalse, reason: 'edited is not pinned');
    });
  });

  group('days', () {
    ChatMessage sentAt(int ms) => msg('1', created: ms);

    test('before: is the days before that day: the day itself is not in it', () {
      const day = 'before:2026-11-05';
      expect(run(sentAt(at(2026, 11, 4, 23, 59, 59)), day), isTrue, reason: 'the last second of the day before');
      expect(run(sentAt(at(2026, 11, 5, 0, 0, 0)), day), isFalse, reason: 'midnight starting that day');
      expect(run(sentAt(at(2026, 11, 5, 12)), day), isFalse);
      expect(run(sentAt(at(2026, 11, 6, 12)), day), isFalse);
      expect(run(sentAt(at(2020, 1, 1)), day), isTrue, reason: 'long before');
    });

    test('after: is the days after that day: the day itself is not in it', () {
      const day = 'after:2026-11-05';
      expect(run(sentAt(at(2026, 11, 5, 23, 59, 59)), day), isFalse, reason: 'the last second of that day');
      expect(run(sentAt(at(2026, 11, 6, 0, 0, 0)), day), isTrue, reason: 'midnight starting the next');
      expect(run(sentAt(at(2026, 11, 5, 0, 0, 0)), day), isFalse);
      expect(run(sentAt(at(2026, 11, 4, 12)), day), isFalse);
      expect(run(sentAt(at(2030, 1, 1)), day), isTrue);
    });

    test('after: at the end of a month and a year', () {
      expect(run(sentAt(at(2026, 12, 1, 0, 0, 0)), 'after:2026-11-30'), isTrue);
      expect(run(sentAt(at(2026, 11, 30, 23, 59, 59)), 'after:2026-11-30'), isFalse);
      expect(run(sentAt(at(2027, 1, 1, 0, 0, 0)), 'after:2026-12-31'), isTrue);
      expect(run(sentAt(at(2026, 12, 31, 23, 59, 59)), 'after:2026-12-31'), isFalse);
    });

    test('on: is that day, all of it, and nothing either side', () {
      const day = 'on:2026-11-05';
      expect(run(sentAt(at(2026, 11, 5, 0, 0, 0)), day), isTrue, reason: 'its first second');
      expect(run(sentAt(at(2026, 11, 5, 23, 59, 59)), day), isTrue, reason: 'its last second');
      expect(run(sentAt(at(2026, 11, 4, 23, 59, 59)), day), isFalse);
      expect(run(sentAt(at(2026, 11, 6, 0, 0, 0)), day), isFalse);
    });

    test('a range: after one day and before another', () {
      final days = [for (var d = 1; d <= 5; d++) msg('d$d', created: at(2026, 11, d, 12))];
      expect(ids(days.where((m) => run(m, 'after:2026-11-01 before:2026-11-05'))), ['d2', 'd3', 'd4']);
    });

    test('a message not sent yet has no day', () {
      final pending = msg('1', pending: true);
      expect(run(pending, 'on:2026-11-10'), isFalse);
      expect(run(pending, 'before:2030-01-01'), isFalse);
      expect(run(pending, 'after:2000-01-01'), isFalse);
      expect(run(pending, 'from:name'), isTrue, reason: 'no day filter: still there');
    });
  });

  test('words and every filter all have to hold', () {
    final m = msg('1', text: 'Release notes https://a.b', uid: 'ana', imageURL: 'x', pinned: true);
    expect(run(m, 'release from:ana has:image has:link is:pinned on:2026-11-10'), isTrue);
    for (final q in ['banana from:ana', 'release from:ben', 'release has:voice', 'release is:edited', 'release on:2026-11-11', 'release after:2026-11-10']) {
      expect(run(m, q), isFalse, reason: q);
    }
  });

  group('searching', () {
    test('matches come newest first (the list is oldest first)', () {
      final list = [msg('1', text: 'a cat'), msg('2', text: 'a dog'), msg('3', text: 'a cat again')];
      final r = searchMessages(list, 'cat', usersById: users, meUid: 'me');
      expect(ids(r.results), ['3', '1']);
      expect(r.active, isTrue);
    });

    test('a filter on its own is a search: no words needed', () {
      final list = [msg('1', imageURL: 'x'), msg('2'), msg('3', imageURL: 'y')];
      final r = searchMessages(list, 'has:image', usersById: users, meUid: 'me');
      expect(ids(r.results), ['3', '1']);
      expect(r.active, isTrue);
    });

    test('nothing to search for is no results, and not active', () {
      final list = [msg('1'), msg('2')];
      for (final q in ['', '   ', 'from:', 'has:banana', 'before:nonsense']) {
        final r = searchMessages(list, q, usersById: users, meUid: 'me');
        expect(r.results, isEmpty, reason: q);
        expect(r.active, isFalse, reason: q);
      }
      expect(searchMessages(list, 'has:banana', usersById: users).parsed.problems, hasLength(1), reason: 'but the problem is reported');
    });

    test('no messages is no results', () {
      expect(searchMessages(const [], 'x', usersById: users).results, isEmpty);
    });

    test('at most 100 results, the newest 100', () {
      final list = [for (var i = 0; i < 150; i++) msg('$i', text: 'hit')];
      final r = searchMessages(list, 'hit');
      expect(r.results, hasLength(100));
      expect(r.results.first.id, '149');
      expect(r.results.last.id, '50');
    });

    test('exactly the limit, and one fewer, and a limit of your own', () {
      final list = [for (var i = 0; i < 100; i++) msg('$i', text: 'hit')];
      expect(searchMessages(list, 'hit').results, hasLength(100));
      expect(searchMessages(list.sublist(1), 'hit').results, hasLength(99));
      expect(ids(searchMessages(list, 'hit', limit: 3).results), ['99', '98', '97']);
    });

    test('the limit counts matches, not messages looked at', () {
      final list = [for (var i = 0; i < 300; i++) msg('$i', text: i % 3 == 0 ? 'hit' : 'miss')];
      final r = searchMessages(list, 'hit');
      expect(r.results, hasLength(100));
      expect(r.results.first.id, '297');
    });

    test('knows who you are and who people are: from:me, from:name, mentions:name', () {
      final list = [
        msg('mine', uid: 'me', text: 'x'),
        msg('anas', uid: 'ana', text: 'x', mentions: ['ben']),
        msg('bens', uid: 'ben', text: 'x'),
      ];
      expect(ids(searchMessages(list, 'from:me', usersById: users, meUid: 'me').results), ['mine']);
      expect(ids(searchMessages(list, 'from:ana', usersById: users, meUid: 'me').results), ['anas']);
      expect(ids(searchMessages(list, 'mentions:cruz', usersById: users, meUid: 'me').results), ['anas']);
      expect(searchMessages(list, 'from:me', usersById: users).results, isEmpty, reason: 'with nobody known to be you');
    });

    test('leaves the list it was given alone', () {
      final list = [msg('1', text: 'x'), msg('2', text: 'x')];
      searchMessages(list, 'x');
      expect(ids(list), ['1', '2']);
    });

    test('the query is handed back taken apart, for showing any problems', () {
      final r = searchMessages([msg('1')], 'hello from:ana has:nope', usersById: users);
      expect(r.parsed.text, 'hello');
      expect(r.parsed.from, ['ana']);
      expect(r.parsed.problems, hasLength(1));
    });
  });

  group('the buttons', () {
    test('put the filter in the box, and take it out again', () {
      expect(toggleToken('', 'has:image'), 'has:image');
      expect(toggleToken('hello', 'has:image'), 'hello has:image');
      expect(toggleToken('hello has:image', 'has:image'), 'hello');
      expect(toggleToken('has:image', 'has:image'), '');
      expect(toggleToken('has:image hello is:pinned', 'has:image'), 'hello is:pinned', reason: 'the rest is left as it was');
    });

    test('know their filter however it was typed', () {
      expect(hasToken('hello HAS:Image', 'has:image'), isTrue);
      expect(toggleToken('hello HAS:Image', 'has:image'), 'hello');
      expect(hasToken('hello', 'has:image'), isFalse);
      expect(hasToken('', 'has:image'), isFalse);
      expect(hasToken(null, 'has:image'), isFalse);
      expect(hasToken('has:imagery', 'has:image'), isFalse, reason: 'a longer word is another word');
      expect(toggleToken('has:imagery', 'has:image'), 'has:imagery has:image');
      expect(hasToken('xhas:image', 'has:image'), isFalse);
    });

    test('tidy the spaces, and take null as empty', () {
      expect(toggleToken('  hello   world ', 'is:pinned'), 'hello world is:pinned');
      expect(toggleToken(null, 'is:pinned'), 'is:pinned');
    });

    test('what a button puts in the box is read back as that filter', () {
      for (final c in searchChips) {
        final p = parseSearch(toggleToken('hi', c.token));
        expect(p.text, 'hi', reason: c.token);
        expect(p.problems, isEmpty, reason: c.token);
        expect(p.hasFilters, isTrue, reason: c.token);
      }
    });
  });

  group('accents and capitals', () {
    test('words ignore accents and capitals, in the text, either way round', () {
      final m = msg('a', text: 'Un Café con José, naïve Straße');
      for (final q in ['cafe', 'CAFÉ', 'jose', 'JOSÉ', 'naive', 'strasse', 'STRAßE', 'con jose']) {
        expect(run(m, q), isTrue, reason: q);
      }
      expect(run(m, 'cafes'), isFalse);
      expect(run(msg('b', text: 'plain cafe'), 'café'), isTrue);
    });

    test('words written with a mark as a separate character still match', () {
      final mark = String.fromCharCode(0x301);
      expect(run(msg('a', text: 'cafe$mark'), 'cafe'), isTrue);
      expect(run(msg('a', text: 'cafe'), 'cafe$mark'), isTrue);
    });

    test('from: ignores accents and capitals in the name', () {
      final m = msg('a', uid: 'j', name: 'José Núñez');
      expect(run(m, 'from:jose', usersById: const {}), isTrue);
      expect(run(m, 'from:NUNEZ', usersById: const {}), isTrue);
      expect(run(m, 'from:josé', usersById: const {}), isTrue);
      expect(run(m, 'from:"jose nunez"', usersById: const {}), isTrue);
      expect(run(m, 'from:ana', usersById: const {}), isFalse);
      final named = msg('b', uid: 'x', name: 'x');
      expect(run(named, 'from:jose', usersById: {'x': user('x', 'José')}), isTrue);
    });

    test('mentions: ignores accents and capitals in the name', () {
      final m = msg('a', mentions: ['j']);
      final who = {'j': user('j', 'José Núñez')};
      expect(run(m, 'mentions:jose', usersById: who), isTrue);
      expect(run(m, 'mentions:NÚÑEZ', usersById: who), isTrue);
      expect(run(m, 'mentions:ana', usersById: who), isFalse);
    });

    test('a mention of someone who is gone does not throw', () {
      expect(run(msg('a', mentions: ['gone']), 'mentions:x', usersById: const {}), isFalse);
    });

    test('the search is made with the folding (pinned against the source)', () {
      final s = File('lib/utils/search_filters.dart').readAsStringSync().replaceAll('\r\n', '\n');
      expect(s.contains("import 'fold.dart';"), isTrue);
      expect(s.contains('!foldText(hideSpoilers(m.text)).contains(foldText(p.text))'), isTrue);
      expect(s.contains('final name = _foldName(_authorName(m, usersById));'), isTrue);
      expect(s.contains('name.contains(_foldName(v))'), isTrue);
      expect(s.contains('_foldName(usersById[uid]?.name).contains(_foldName(v))'), isTrue);
      expect(s.contains('.toLowerCase().contains('), isFalse);
    });
  });

  group('found by review: marks alone, spoilers, quotes in names', () {
    final mark = String.fromCharCode(0x301); // an accent on its own

    test('a query that is only an accent is nothing to look for (folded it is empty, and empty is in every text)', () {
      expect(parseSearch(mark).text, '');
      expect(parseSearch('  $mark  ').text, '');
      expect(parseSearch('from:$mark').from, isEmpty);
      expect(parseSearch('mentions:"$mark"').mentions, isEmpty);
      final ms = [msg('a'), msg('b')];
      expect(searchMessages(ms, mark, usersById: users).active, isFalse);
      expect(searchMessages(ms, mark, usersById: users).results, isEmpty);
      expect(searchMessages(ms, 'from:$mark', usersById: users).active, isFalse);
      // with other words the accent is still part of them
      expect(parseSearch('cafe $mark').text, 'cafe $mark');
    });

    test('search finds only what can be read: the words a spoiler hides are not found, "[spoiler]" is', () {
      final m1 = msg('a', text: 'the ||secret|| code');
      expect(run(m1, 'secret'), isFalse, reason: 'a hidden word is not found');
      expect(run(m1, 'code'), isTrue);
      expect(run(m1, 'the'), isTrue);
      expect(run(m1, 'spoiler'), isTrue, reason: 'what is shown is "[spoiler]"');
      expect(run(m1, 'the [spoiler] code'), isTrue);
      expect(run(msg('b', text: 'no bars here, secret'), 'secret'), isTrue, reason: 'the same word in the open is found');
      expect(run(msg('c', text: '||two|| and ||words||'), 'words'), isFalse);
      // a filter that looks at the whole message is unchanged
      expect(run(msg('d', text: '||https://x.test/a||'), 'has:link'), isTrue);
    });

    test('a name with a double quote is found by the piece the picker writes (the quote is left out of it)', () {
      final quoted = msg('q', uid: 'q', name: 'Ana "Boss" Reyes', mentions: ['q']);
      final who = {'q': user('q', 'Ana "Boss" Reyes')};
      expect(run(quoted, 'from:"Ana Boss Reyes"', usersById: who), isTrue);
      expect(run(quoted, 'mentions:"Ana Boss Reyes"', usersById: who), isTrue);
      expect(run(quoted, 'from:boss', usersById: who), isTrue);
      expect(run(quoted, 'from:ben', usersById: who), isFalse);
      expect(run(msg('n', uid: 'n', name: 'Plain Name'), 'from:"Ana Boss"', usersById: who), isFalse);
    });

    test('a piece of only quotes names nobody (it would have named everyone)', () {
      expect(parseSearch('from:""').from, isEmpty);
      expect(run(msg('a'), 'from:""'), isTrue, reason: 'no filter at all, as before');
    });
  });
}
