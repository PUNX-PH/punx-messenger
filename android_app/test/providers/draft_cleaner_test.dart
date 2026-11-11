import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/providers/auth_providers.dart';
import 'package:punx_messenger/providers/draft_providers.dart';
import 'package:punx_messenger/services/auth_service.dart';
import 'package:punx_messenger/services/draft_store.dart';

class _FakeUser implements fb_auth.User {
  _FakeUser(this.uid);
  @override
  final String uid;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeAuth implements AuthService {
  final controller = StreamController<fb_auth.User?>();
  @override
  Stream<fb_auth.User?> authStateChanges() => controller.stream;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late _FakeAuth auth;
  late DraftStore drafts;
  late ProviderContainer container;

  Future<void> settle() => Future<void>.delayed(Duration.zero);

  setUp(() async {
    auth = _FakeAuth();
    drafts = DraftStore.inMemory();
    container = ProviderContainer(
      overrides: [
        authServiceProvider.overrideWithValue(auth),
        draftStoreProvider.overrideWithValue(drafts),
      ],
    );
    container.listen(draftCleanerProvider, (_, _) {});
    // Keep the auth stream alive the way the app does.
    container.listen(authStateProvider, (_, _) {});
  });

  tearDown(() async {
    container.dispose();
    await auth.controller.close();
  });

  test(
    'signing out wipes every draft, so the next person does not see them',
    () async {
      auth.controller.add(_FakeUser('ana'));
      await settle();
      drafts.set('ana:dms/x/messages', 'half written');
      drafts.set('ana:groups/g/channels/c/messages', 'another');

      auth.controller.add(null);
      await settle();

      expect(drafts.get('ana:dms/x/messages'), '');
      expect(drafts.get('ana:groups/g/channels/c/messages'), '');
    },
  );

  test(
    'staying signed in keeps drafts, even as the user object refreshes',
    () async {
      auth.controller.add(_FakeUser('ana'));
      await settle();
      drafts.set('ana:dms/x/messages', 'keep');

      auth.controller.add(_FakeUser('ana')); // token refresh: same person
      await settle();

      expect(drafts.get('ana:dms/x/messages'), 'keep');
    },
  );

  test(
    'being signed out at start-up does not touch drafts (nothing changed)',
    () async {
      drafts.set('ana:dms/x/messages', 'restored from storage');
      auth.controller.add(null); // first value ever: signed out
      await settle();
      // Not a sign-out event: the person was never seen signed in this run. The
      // keys carry the account, so another account still cannot read these.
      expect(drafts.get('ana:dms/x/messages'), 'restored from storage');
    },
  );
}
