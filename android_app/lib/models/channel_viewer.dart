/// Which channel queries one person is allowed to run — a port of
/// channelViewer() in src/lib/auth.jsx.
///
/// Nobody queries a group's channels unfiltered any more. firestore.rules
/// reads `private` off the channel without an existence guard, so an
/// unfiltered query leaves that field unknown, which errors, and an error
/// denies. Only a query that pins `private` — or pins `allowUids` to the
/// caller — can be proven safe. See GroupsRepository.listenChannels for the
/// legs this feeds, and channelViewerProvider for how one gets built.
class ChannelViewer {
  const ChannelViewer({this.uid, this.guest = false, this.seesPrivate = false});

  /// Signed out, or a profile that hasn't loaded yet: public channels only.
  static const anonymous = ChannelViewer();

  final String? uid;

  /// Guests are exact — the narrow `allowUids` query is the only one the rules
  /// will serve them, so getting this wrong shows them nothing at all.
  final bool guest;

  /// Optimistic. It only decides whether the private-channel leg is worth
  /// attempting, and that leg is dropped if it's denied, so a case the client
  /// can't reproduce (a workspace admin inside a developer-owned group, where
  /// the rules grant them nothing) costs only channels they couldn't see.
  final bool seesPrivate;

  // Value equality matters here, and its absence is a live bug: this object is
  // what channelViewerProvider hands to channelsProvider, and Riverpod decides
  // whether to notify dependents with ==. Without it, every recomputation looks
  // like a change, so the channel streams are torn down and resubscribed and
  // the list blanks and refills — which reads as the page flickering.
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChannelViewer &&
          other.uid == uid &&
          other.guest == guest &&
          other.seesPrivate == seesPrivate;

  @override
  int get hashCode => Object.hash(uid, guest, seesPrivate);
}
