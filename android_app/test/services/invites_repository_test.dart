import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/config/app_config.dart';
import 'package:punx_messenger/models/channel.dart';
import 'package:punx_messenger/models/group.dart';
import 'package:punx_messenger/services/invites_repository.dart';

void main() {
  group('newToken', () {
    test('is 43 URL-safe characters — 256 bits', () {
      final t = InvitesRepository.newToken();
      expect(t, hasLength(43));
      // firestore.rules accepts at most 128 characters of [A-Za-z0-9_-].
      expect(t, matches(RegExp(r'^[A-Za-z0-9_-]+$')));
      expect(t.length, lessThanOrEqualTo(128));
    });

    test('is not repeated', () {
      final seen = {
        for (var i = 0; i < 2000; i++) InvitesRepository.newToken(),
      };
      expect(seen, hasLength(2000));
    });

    test('uses the whole alphabet, not a narrower slice of it', () {
      final chars = <String>{};
      for (var i = 0; i < 200; i++) {
        chars.addAll(InvitesRepository.newToken().split(''));
      }
      expect(chars, hasLength(64));
    });

    test('takes an injected generator, so the output is reproducible', () {
      expect(
        InvitesRepository.newToken(Random(1)),
        InvitesRepository.newToken(Random(1)),
      );
    });
  });

  test('the link points at the configured web origin', () {
    expect(
      InvitesRepository.inviteUrl('abc'),
      '${AppConfig.webOrigin}/invite/abc',
    );
    expect(AppConfig.webOrigin, isNot(endsWith('/')));
  });

  group('inviteData', () {
    const group = Group(id: 'g1', name: 'Test', ownerUid: 'owner');
    final expires = DateTime(2026, 10, 22, 12);
    final channels = [
      const Channel(id: 'c1', name: 'general'),
      const Channel(id: 'c2', name: 'music'),
    ];

    test('has exactly the fields the web client writes', () {
      final data = InvitesRepository.inviteData(
        group: group,
        channels: channels,
        createdBy: 'me',
        expiresAt: expires,
      );
      // src/lib/invites.js createInvite(): anything missing here is a field the
      // accept screen or the admin list silently loses.
      expect(data.keys.toSet(), {
        'groupId',
        'groupName',
        'channelIds',
        'channelNames',
        'createdBy',
        'createdAt',
        'expiresAt',
        'revoked',
      });
    });

    test('satisfies what firestore.rules checks on create', () {
      final data = InvitesRepository.inviteData(
        group: group,
        channels: channels,
        createdBy: 'me',
        expiresAt: expires,
      );
      expect(data['groupId'], isA<String>());
      expect(data['channelIds'], isA<List>());
      expect(data['expiresAt'], isA<Timestamp>()); // `expiresAt is timestamp`
      expect(data['createdBy'], 'me'); // must equal the caller's uid
      expect(data['revoked'], false);
    });

    test('carries the channel ids and names in the same order', () {
      final data = InvitesRepository.inviteData(
        group: group,
        channels: channels,
        createdBy: 'me',
        expiresAt: expires,
      );
      expect(data['channelIds'], ['c1', 'c2']);
      expect(data['channelNames'], ['general', 'music']);
    });

    test('an unnamed group still gets a readable name', () {
      final data = InvitesRepository.inviteData(
        group: const Group(id: 'g', name: '', ownerUid: 'o'),
        channels: channels,
        createdBy: 'me',
        expiresAt: expires,
      );
      expect(data['groupName'], 'a group');
    });
  });
}
