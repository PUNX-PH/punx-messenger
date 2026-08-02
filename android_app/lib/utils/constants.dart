/// Timing constants centralized here, ported 1:1 from the web app so the
/// two clients stay behaviorally in sync (presence.jsx, notifications.jsx,
/// Composer.jsx, ChatSurface.jsx, MessageList.jsx).
abstract final class AppTiming {
  // presence.jsx
  static const heartbeatMs = 45000; // write lastSeen every 45s while active
  static const awayAfterMs = 5 * 60000; // 5 min of no activity -> away
  static const offlineAfterMs =
      2 * 60000; // no heartbeat within 2 min -> offline
  static const presenceTickMs = 30000; // re-render presence dots every 30s

  // Composer.jsx / ChatSurface.jsx typing indicator
  static const typingPingThrottleMs =
      3000; // ping onTyping(true) at most this often
  static const typingStopAfterMs =
      5000; // auto onTyping(false) after this much inactivity
  static const typingStaleMs =
      6000; // reader treats a typing entry older than this as stale
  static const typingTickMs = 2000; // re-check staleness this often

  // MessageList.jsx — same-author clustering window, relative to the *last*
  // message in the current run (not the group's first message).
  static const messageGroupingWindowMs = 5 * 60000;

  // db.js listenMessages() / SearchDropdown.jsx
  static const messageLoadLimit = 200;
  static const searchResultCap = 100;

  // calls.js / useCall.jsx — no-answer timeout for an outbound ringing call.
  static const callNoAnswerTimeoutMs = 45000;
}
