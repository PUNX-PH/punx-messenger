import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/models/channel.dart';
import 'package:punx_messenger/models/dm_convo.dart';
import 'package:punx_messenger/models/group.dart';
import 'package:punx_messenger/models/role.dart';
import 'package:punx_messenger/models/user_profile.dart';
import 'package:punx_messenger/utils/forward_targets.dart';

UserProfile _u(String id, String name, {String? email}) =>
    UserProfile(id: id, email: email ?? '$id@x.test', name: name, role: Role.employee);

Timestamp _t(int ms) => Timestamp.fromMillisecondsSinceEpoch(ms);

const _g1 = Group(id: 'g1', name: 'Team', ownerUid: 'me', adminUids: ['me'], memberUids: ['me']);
const _g2 = Group(id: 'g2', name: 'Friends', ownerUid: 'me', adminUids: ['me'], memberUids: ['me']);

List<ForwardTarget> _build({
  List<UserProfile> users = const [],
  Map<String, DmConvo> convos = const {},
  List<Group> groups = const [],
  Map<String, List<Channel>> channels = const {},
  Map<String, Timestamp> lastRead = const {},
  Set<String> mutedGroups = const {},
  Set<String> mutedChats = const {},
  String? currentPath,
}) => buildForwardTargets(
  meUid: 'me',
  users: users,
  convosByOther: convos,
  groups: groups,
  channelsByGroup: channels,
  lastRead: lastRead,
  mutedGroups: mutedGroups,
  mutedChats: mutedChats,
  currentPath: currentPath,
);

ForwardTarget _dm(String id, String label, {String hint = '', bool unread = false, int at = 0}) =>
    ForwardTarget(id: 'dm:$id', kind: TargetKind.dm, label: label, hint: hint, path: 'dms/$id/messages', unread: unread, at: at);

ForwardTarget _ch(String id, String label, {String hint = 'Team', bool unread = false, int at = 0}) =>
    ForwardTarget(id: 'ch:$id', kind: TargetKind.channel, label: label, hint: hint, path: 'groups/g/channels/$id/messages', unread: unread, at: at);

List<String> _labels(List<ForwardTarget> ts) => [for (final t in ts) t.label];

void main() {
  group('buildForwardTargets', () {
    test('My Notes is always there, first, and is the person\'s own', () {
      final t = _build();
      expect(t, hasLength(1));
      expect(t.single.kind, TargetKind.notes);
      expect(t.single.label, 'My Notes');
      expect(t.single.hint, 'Private to you');
      expect(t.single.path, 'users/me/notes');
    });

    test('people are offered, never yourself, each at the conversation id both of you compute', () {
      final t = _build(users: [_u('me', 'Me'), _u('zed', 'Zed Cruz', email: 'z@x.test')]);
      expect(_labels(t), ['My Notes', 'Zed Cruz']);
      final zed = t[1];
      expect(zed.kind, TargetKind.dm);
      expect(zed.id, 'dm:zed');
      expect(zed.hint, 'z@x.test');
      expect(zed.path, 'dms/me__zed/messages');
      expect(zed.user?.id, 'zed');
      expect(_build(users: [_u('amy', 'Amy')])[1].path, 'dms/amy__me/messages', reason: 'ids are sorted');
    });

    test('a person with no name is shown by their email, and with neither as Unknown', () {
      final t = _build(users: [_u('a', '', email: 'a@x.test'), _u('b', '', email: '')]);
      expect(t[1].label, 'a@x.test');
      expect(t[2].label, 'Unknown');
    });

    test('text channels are offered under their group, voice rooms never', () {
      final t = _build(
        groups: [_g1, _g2],
        channels: {
          'g1': [const Channel(id: 'c1', name: 'general'), const Channel(id: 'v1', name: 'lounge', type: 'voice')],
          'g2': [const Channel(id: 'c2', name: '')],
        },
      );
      expect(_labels(t), ['My Notes', 'general', 'channel']);
      expect(t[1].kind, TargetKind.channel);
      expect(t[1].hint, 'Team');
      expect(t[1].path, 'groups/g1/channels/c1/messages');
      expect(t[1].id, 'ch:g1:c1');
      expect(t[2].hint, 'Friends');
    });

    test('the conversation the message is already in is left out', () {
      final all = _build(
        users: [_u('zed', 'Zed')],
        groups: [_g1],
        channels: {'g1': [const Channel(id: 'c1', name: 'general')]},
      );
      expect(_build(users: [_u('zed', 'Zed')], groups: [_g1], channels: {'g1': [const Channel(id: 'c1', name: 'general')]}, currentPath: 'dms/me__zed/messages').map((t) => t.label), ['My Notes', 'general']);
      expect(_build(users: [_u('zed', 'Zed')], groups: [_g1], channels: {'g1': [const Channel(id: 'c1', name: 'general')]}, currentPath: 'groups/g1/channels/c1/messages').map((t) => t.label), ['My Notes', 'Zed']);
      expect(_build(users: [_u('zed', 'Zed')], groups: [_g1], channels: {'g1': [const Channel(id: 'c1', name: 'general')]}, currentPath: 'users/me/notes').map((t) => t.label), ['Zed', 'general']);
      expect(all, hasLength(3));
    });

    test('how recent each is comes from its newest message', () {
      final t = _build(
        users: [_u('zed', 'Zed')],
        convos: {'zed': DmConvo(id: 'me__zed', members: const ['me', 'zed'], lastMessageAt: _t(5000))},
        groups: [_g1],
        channels: {'g1': [Channel(id: 'c1', name: 'general', lastMessageAt: _t(7000))]},
      );
      expect(t[1].at, 5000);
      expect(t[2].at, 7000);
      expect(t[0].at, 0);
    });

    test('a DM is unread when the other person wrote last and you have not read it', () {
      DmConvo convo(String? author) => DmConvo(id: 'me__zed', members: const ['me', 'zed'], lastMessageAt: _t(5000), lastMessageAuthorUid: author);
      bool unread({String? author = 'zed', Map<String, Timestamp> read = const {}, Set<String> muted = const {}}) =>
          _build(users: [_u('zed', 'Zed')], convos: {'zed': convo(author)}, lastRead: read, mutedChats: muted)[1].unread;
      expect(unread(), isTrue);
      expect(unread(author: 'me'), isFalse, reason: 'you wrote last');
      expect(unread(author: null), isFalse);
      expect(unread(read: {'dms__me__zed': _t(6000)}), isFalse, reason: 'read since');
      expect(unread(read: {'dms__me__zed': _t(4000)}), isTrue, reason: 'read before');
      expect(unread(muted: {'dms__me__zed'}), isFalse, reason: 'muted');
      expect(_build(users: [_u('zed', 'Zed')])[1].unread, isFalse, reason: 'no conversation yet');
    });

    test('a channel is unread unless read since, muted, or in a muted group', () {
      bool unread({Map<String, Timestamp> read = const {}, Set<String> mutedChats = const {}, Set<String> mutedGroups = const {}}) => _build(
        groups: [_g1],
        channels: {'g1': [Channel(id: 'c1', name: 'general', lastMessageAt: _t(5000))]},
        lastRead: read,
        mutedChats: mutedChats,
        mutedGroups: mutedGroups,
      )[1].unread;
      expect(unread(), isTrue);
      expect(unread(read: {'groups__g1__channels__c1': _t(6000)}), isFalse);
      expect(unread(mutedChats: {'groups__g1__channels__c1'}), isFalse);
      expect(unread(mutedGroups: {'g1'}), isFalse);
      expect(unread(mutedGroups: {'g2'}), isTrue);
    });
  });

  group('normalizeForSearch', () {
    test('lower-cases and strips common accents', () {
      expect(normalizeForSearch('Zoë'), 'zoe');
      expect(normalizeForSearch('JOSÉ Muñoz'), 'jose munoz');
      expect(normalizeForSearch('Åsa Østby'), 'asa ostby');
      expect(normalizeForSearch('plain Text 123 #-_'), 'plain text 123 #-_');
    });
  });

  group('rankForwardTargets with nothing typed', () {
    final all = [
      _dm('a', 'Old', at: 100),
      _dm('b', 'Newest', at: 900),
      _dm('c', 'Unread', unread: true, at: 50),
      _ch('d', 'Middle', at: 500),
      _dm('e', 'Alpha', at: 100),
    ];

    test('what is unread first, then the most recently active, then by name', () {
      expect(_labels(rankForwardTargets(all, '')), ['Unread', 'Newest', 'Middle', 'Alpha', 'Old']);
    });

    test('a blank query is no query', () {
      expect(_labels(rankForwardTargets(all, '   ')), ['Unread', 'Newest', 'Middle', 'Alpha', 'Old']);
    });

    test('only as many as asked for', () {
      expect(_labels(rankForwardTargets(all, '', limit: 2)), ['Unread', 'Newest']);
    });

    test('the same time is told apart by name, whatever the case', () {
      final t = [_dm('1', 'bob', at: 5), _dm('2', 'alice', at: 5), _dm('3', 'Carl', at: 5)];
      expect(_labels(rankForwardTargets(t, '')), ['alice', 'bob', 'Carl']);
    });
  });

  group('rankForwardTargets with a query', () {
    test('a name that starts with it beats a word that does, which beats the middle of a word, which beats letters picked out in order', () {
      final t = [_dm('1', 'Anna Marie'), _dm('2', 'Maria Ana'), _dm('3', 'Banana'), _dm('4', 'Ana')];
      expect(_labels(rankForwardTargets(t, 'ana')), ['Ana', 'Maria Ana', 'Banana', 'Anna Marie']);
    });

    test('a group name counts, but less than the name itself', () {
      final start = _dm('s', 'marketing');
      final word = _dm('w', 'the marketing');
      final inside = _dm('i', 'supermarketing');
      final hint = _dm('h', 'zzz', hint: 'marketing team');
      expect(_labels(rankForwardTargets([hint, inside, word, start], 'marketing')), ['marketing', 'the marketing', 'supermarketing', 'zzz']);
    });

    test('a match on the group name beats letters picked out in order', () {
      final letters = _dm('l', 'marketing');
      final viaGroup = _dm('g', 'zzz', hint: 'mkt team');
      expect(_labels(rankForwardTargets([letters, viaGroup], 'mkt')), ['zzz', 'marketing']);
    });

    test('letters in order only count from the start of a word: "ana" does not find "brand-assets"', () {
      expect(rankForwardTargets([_ch('1', 'brand-assets')], 'ana'), isEmpty);
      expect(_labels(rankForwardTargets([_dm('2', 'marketing')], 'mkt')), ['marketing']);
      expect(_labels(rankForwardTargets([_dm('3', 'big marketing')], 'mkt')), ['big marketing']);
    });

    test('every word must match somewhere', () {
      final t = [_dm('1', 'Ana Reyes'), _dm('2', 'Ana Cruz'), _dm('3', 'Bo Reyes')];
      expect(_labels(rankForwardTargets(t, 'ana reyes')), ['Ana Reyes']);
      expect(_labels(rankForwardTargets(t, 'ana  reyes')), ['Ana Reyes']);
      expect(rankForwardTargets(t, 'ana zzz'), isEmpty);
    });

    test('the group a channel is in is searched too', () {
      final t = [_ch('1', 'general', hint: 'Friends'), _ch('2', 'random', hint: 'Team')];
      expect(_labels(rankForwardTargets(t, 'friends')), ['general']);
      expect(_labels(rankForwardTargets(t, 'gen friends')), ['general']);
    });

    test('accents and case do not matter, in the name or the query', () {
      final t = [_dm('1', 'Zoë Park')];
      expect(_labels(rankForwardTargets(t, 'zoe')), ['Zoë Park']);
      expect(_labels(rankForwardTargets(t, 'ZOË')), ['Zoë Park']);
    });

    test('a leading # means channels only and @ means people only', () {
      final t = [_dm('1', 'General Gil'), _ch('2', 'general'), _dm('3', 'Gen Y')];
      expect(_labels(rankForwardTargets(t, '#gen')), ['general']);
      expect(_labels(rankForwardTargets(t, '@gen')), ['Gen Y', 'General Gil']);
      expect(_labels(rankForwardTargets(t, 'gen')).toSet(), {'General Gil', 'general', 'Gen Y'});
    });

    test('# or @ alone lists just that kind', () {
      final t = [_dm('1', 'Ana'), _ch('2', 'general'), const ForwardTarget(id: 'notes', kind: TargetKind.notes, label: 'My Notes', hint: '', path: 'users/me/notes')];
      expect(_labels(rankForwardTargets(t, '#')), ['general']);
      expect(_labels(rankForwardTargets(t, '@')), ['Ana']);
      expect(_labels(rankForwardTargets(t, ' # ')), ['general']);
    });

    test('an unread one rises past an otherwise equal one', () {
      final t = [_dm('1', 'Ana Read', at: 900), _dm('2', 'Ana Unread', unread: true, at: 100)];
      expect(_labels(rankForwardTargets(t, 'ana')), ['Ana Unread', 'Ana Read']);
    });

    test('but a better match is not beaten by an unread worse one', () {
      final t = [_dm('1', 'Zed Ana', unread: true), _dm('2', 'Ana Zed')];
      // "Zed Ana" matches at a word start (80 + 15 unread = 95); "Ana Zed" at the start (100).
      expect(_labels(rankForwardTargets(t, 'ana')), ['Ana Zed', 'Zed Ana']);
    });

    test('the same score is told apart by recency, then name', () {
      final t = [_dm('1', 'Ana B', at: 1), _dm('2', 'Ana A', at: 1), _dm('3', 'Ana C', at: 9)];
      expect(_labels(rankForwardTargets(t, 'ana')), ['Ana C', 'Ana A', 'Ana B']);
    });

    test('only as many as asked for', () {
      final t = [for (var i = 0; i < 30; i++) _dm('$i', 'Ana $i', at: i)];
      expect(rankForwardTargets(t, 'ana'), hasLength(20));
      expect(rankForwardTargets(t, 'ana', limit: 3), hasLength(3));
    });

    test('nothing matching is nothing', () {
      expect(rankForwardTargets([_dm('1', 'Ana')], 'xyz'), isEmpty);
    });
  });

  group('forwardedToName', () {
    test('says where it went, as the note will', () {
      expect(forwardedToName(const ForwardTarget(id: 'n', kind: TargetKind.notes, label: 'My Notes', hint: '', path: 'p')), 'your notes');
      expect(forwardedToName(_ch('c', 'general')), '#general');
      expect(forwardedToName(_dm('d', 'Ana Reyes')), 'Ana Reyes');
    });
  });

  group('forwardPreviewLine', () {
    test('the text on one line', () {
      expect(forwardPreviewLine('  hello\n\n  there   friend ', hasVoice: false), 'hello there friend');
    });

    test('cut at 160 characters with an ellipsis, and not before', () {
      expect(forwardPreviewLine('x' * 160, hasVoice: false), 'x' * 160);
      expect(forwardPreviewLine('x' * 161, hasVoice: false), '${'x' * 160}…');
      expect(forwardPreviewLine('x' * 20, hasVoice: false, max: 10), '${'x' * 10}…');
    });

    test('a character outside the basic plane counts as one and is never split', () {
      final line = forwardPreviewLine('\u{1F600}' * 11, hasVoice: false, max: 10);
      expect(line, '${'\u{1F600}' * 10}…');
    });

    test('with no words it says what it carries', () {
      expect(forwardPreviewLine('', hasVoice: true), '[voice message]');
      expect(forwardPreviewLine('   ', hasVoice: false), '[image]');
    });
  });
}
