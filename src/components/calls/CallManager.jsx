import IncomingCallModal from './IncomingCallModal'
import CallOverlay from './CallOverlay'
import CallErrorToast from './CallErrorToast'

/**
 * Always-mounted (sibling of PresenceHeartbeat/NotificationDaemon in
 * App.jsx) so a call survives route navigation. Renders nothing when idle
 * and error-free.
 */
export default function CallManager() {
  return (
    <>
      <IncomingCallModal />
      <CallOverlay />
      <CallErrorToast />
    </>
  )
}
