// Do not disturb: a switch on a person's own profile that silences the pings and notifications for
// a while or until they turn it off. Mirrors src/lib/dnd.js, and stored in the same place
// (`dnd: { until }` on the person's own `users/{uid}` document), so one switched on on the web holds
// on the phone and the other way round.
//
// `until` is a time in milliseconds since 1970, or an explicit null for "until I turn it off". Like
// a status, whether it has ENDED is decided where it is used ([isActiveAt]), so nothing has to run
// to switch it off.

class Dnd {
  const Dnd({this.until});

  /// When it ends; null for "until I turn it off".
  final int? until;

  /// Reads what a profile holds. Null when it is absent or not usable. `until` has to be a number or
  /// an explicit null: a field that is missing, or the wrong type, is never read as "on for ever".
  static Dnd? parse(Object? raw) {
    if (raw is! Map || !raw.containsKey('until')) return null;
    final until = raw['until'];
    if (until == null) return const Dnd();
    if (until is num && until.isFinite) return Dnd(until: until.toInt());
    return null;
  }

  /// Is it still on at [now]? An end that has come, even to the millisecond, is over.
  bool isActiveAt(DateTime now) =>
      until == null || until! > now.millisecondsSinceEpoch;
}
