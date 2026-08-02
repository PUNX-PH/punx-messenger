import IncomingCallModal from './IncomingCallModal'
import CallOverlay from './CallOverlay'

/**
 * Always-mounted (sibling of PresenceHeartbeat/NotificationDaemon in
 * App.jsx) so a call survives route navigation. Renders nothing when idle.
 */
export default function CallManager() {
  return (
    <>
      <IncomingCallModal />
      <CallOverlay />
    </>
  )
}
