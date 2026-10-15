import { useEffect, useRef } from 'react'
import IncomingCallModal from './IncomingCallModal'
import CallErrorToast from './CallErrorToast'
import { useCall } from '../../lib/useCall'
import { callSoundActions } from '../../lib/sfxRules'
import { play, stop } from '../../lib/sfx'

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
      <CallSounds />
    </>
  )
}

/**
 * Ring, ringback and the connected/ended chimes. It lives here, and not in the
 * incoming-call modal, because the ring has to outlast any one view: it must
 * keep sounding if you navigate, and stop the moment the call does.
 */
function CallSounds() {
  const { status } = useCall()
  const prev = useRef('idle')

  useEffect(() => {
    const actions = callSoundActions(prev.current, status)
    prev.current = status
    actions.stop.forEach(stop)
    if (actions.play) play(actions.play)
  }, [status])

  // Never leave a ring running behind a page that has gone away.
  useEffect(() => () => { stop('ring'); stop('ringback') }, [])

  return null
}
