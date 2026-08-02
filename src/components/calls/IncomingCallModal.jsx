import Avatar from '../Avatar'
import Modal from '../Modal'
import { useUsers } from '../../lib/users'
import { useCall } from '../../lib/useCall'

/** Ring/accept/decline dialog shown to the callee. Reuses Modal.jsx as-is —
 * backdrop click / Escape are intentionally wired to decline. */
export default function IncomingCallModal() {
  const { call, status, accept, decline } = useCall()
  const { byId } = useUsers()

  if (status !== 'incoming') return null
  const caller = byId[call.callerUid]

  return (
    <Modal open onClose={decline} maxWidth="max-w-sm">
      <div className="p-6 flex flex-col items-center text-center gap-4">
        <Avatar name={caller?.name} src={caller?.photoURL} size={72} />
        <div>
          <div className="text-lg font-semibold text-ink">{caller?.name || 'Someone'}</div>
          <div className="text-sm text-ink-dim mt-1">Incoming video call…</div>
        </div>
        <div className="flex gap-3 mt-2">
          <button
            onClick={decline}
            className="px-5 py-2 rounded-full bg-bad text-white font-medium hover:opacity-90 transition-opacity"
          >
            Decline
          </button>
          <button
            onClick={accept}
            className="px-5 py-2 rounded-full bg-ok text-white font-medium hover:opacity-90 transition-opacity"
          >
            Accept
          </button>
        </div>
      </div>
    </Modal>
  )
}
