import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/providers/sfx_providers.dart';
import 'package:punx_messenger/services/sfx_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeBackend implements SfxBackend {
  final started = <Sfx>[];
  @override
  Future<void> init() async {}
  @override
  Future<void> start(Sfx sfx) async => started.add(sfx);
  @override
  Future<void> stop(Sfx sfx) async {}
}

void main() {
  late _FakeBackend backend;
  late ProviderContainer container;

  Future<SfxService> boot([Map<String, Object> saved = const {}]) async {
    SharedPreferences.setMockInitialValues(saved);
    backend = _FakeBackend();
    final service = SfxService(backend);
    await service.init();
    container = ProviderContainer(
      overrides: [sfxServiceProvider.overrideWithValue(service)],
    );
    addTearDown(container.dispose);
    container.read(sfxEnabledProvider); // creates the controller, which loads
    await Future<void>.delayed(Duration.zero);
    return service;
  }

  test('sound is on by default', () async {
    final service = await boot();
    expect(container.read(sfxEnabledProvider), isTrue);
    expect(service.enabled, isTrue);
  });

  test(
    'a saved "off" is restored at launch, and silences the service',
    () async {
      final service = await boot({'sfxEnabled': false});
      expect(container.read(sfxEnabledProvider), isFalse);
      expect(service.enabled, isFalse);
      service.play(Sfx.dmPing);
      expect(backend.started, isEmpty);
    },
  );

  test('switching it off is remembered for next time', () async {
    await boot();
    await container.read(sfxEnabledProvider.notifier).setEnabled(false);
    expect(container.read(sfxEnabledProvider), isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('sfxEnabled'), isFalse);
  });

  test('switching it on plays a ping, so you can hear that it works', () async {
    await boot({'sfxEnabled': false});
    await container.read(sfxEnabledProvider.notifier).setEnabled(true);
    expect(container.read(sfxEnabledProvider), isTrue);
    expect(backend.started, [Sfx.dmPing]);
  });

  test('switching it off does not play the ping', () async {
    await boot();
    await container.read(sfxEnabledProvider.notifier).setEnabled(false);
    expect(backend.started, isEmpty);
  });
}
