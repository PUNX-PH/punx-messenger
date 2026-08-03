import IncomingCallModal from './IncomingCallModal'
import CallErrorToast from './CallErrorToast'

/**
 * Always-mounted (sibling of PresenceHeartbeat/NotificationDaemon in
 * App.jsx) so these survive route navigation. Renders nothing when idle
 * and error-free.
 *
 * CallOverlay (the active-call view) is deliberately NOT here — it's
 * mounted inside AppShell's main-content area instead, so it can be sized
 * to just the messaging pane rather than the whole viewport. Both of these
 * two are full-viewport dialogs (Modal portals to document.body; the error
 * toast is a small fixed banner), so they're fine staying at this
 * app-wide level.
 */
export default function CallManager() {
  return (
    <>
      <IncomingCallModal />
      <CallErrorToast />
    </>
  )
}
