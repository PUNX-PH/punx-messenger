import 'package:flutter_test/flutter_test.dart';
import 'package:punx_messenger/screens/groups/voice_channel_screen.dart';

/// The tile grid's shape. Small, but the web got this wrong twice — once
/// leaving a lone participant as a tiny box in a sea of background, once as a
/// single stretched band — so the rule is worth pinning down.
void main() {
  test('one person gets the whole pane', () {
    expect(voiceGridColumns(0), 1);
    expect(voiceGridColumns(1), 1);
  });

  test('columns are ceil(sqrt(n)), so the grid stays square-ish', () {
    expect(voiceGridColumns(2), 2);
    expect(voiceGridColumns(3), 2);
    expect(voiceGridColumns(4), 2);
    expect(voiceGridColumns(5), 3);
    expect(voiceGridColumns(9), 3);
    expect(voiceGridColumns(10), 4);
  });

  test('rows never exceed columns, so tiles never get taller than wide', () {
    for (var n = 1; n <= 16; n++) {
      final cols = voiceGridColumns(n);
      final rows = (n / cols).ceil();
      expect(rows, lessThanOrEqualTo(cols), reason: 'n=$n');
    }
  });
}
