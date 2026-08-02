import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/theme/app_theme.dart';
import 'package:punx_messenger/theme/palette.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('buildAppTheme uses the dark punx palette', () {
    final theme = buildAppTheme();
    expect(theme.scaffoldBackgroundColor, Palette.bgMain);
    expect(theme.colorScheme.brightness, Brightness.dark);
    expect(theme.colorScheme.primary, Palette.brand);
  });
}
