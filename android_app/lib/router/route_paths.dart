/// Route path constants. Mirrors App.jsx's react-router route table.
/// Expanded in later phases as the real screens land.
abstract final class RoutePaths {
  static const splash = '/splash';
  static const login = '/login';

  static const dms = '/dms';
  static const dmConvo = '/dms/:otherUid';
  static const myNotes = '/me/notes';
  static const groups = '/groups';
  static const group = '/g/:groupId';
  static const channel = '/g/:groupId/c/:channelId';
  static const admin = '/admin';

  static String dmConvoPath(String otherUid) => '/dms/$otherUid';
  static String groupPath(String groupId) => '/g/$groupId';
  static String channelPath(String groupId, String channelId) =>
      '/g/$groupId/c/$channelId';
}
