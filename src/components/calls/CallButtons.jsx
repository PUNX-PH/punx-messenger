import { useCall } from '../../lib/useCall'

/**
 * Header button that starts a call with `otherUid`. Passed into ChatSurface's
 * `headerExtras` slot — only from DMConvo.jsx (v1 is DM-only, see Channel.jsx
 * which passes MembersToggle there instead).
 */
export default function CallButtons({ otherUid }) {
  const { call, startCall } = useCall()

  const busyElsewhere = call && !(call.callerUid === otherUid || call.calleeUid === otherUid)
  const alreadyWithThem = call && (call.callerUid === otherUid || call.calleeUid === otherUid)

  const title = alreadyWithThem
    ? 'Already on a call with them'
    : busyElsewhere
      ? 'You’re already on another call'
      : 'Start a call'

  return (
    <button
      onClick={() => startCall(otherUid)}
      disabled={!!call}
      title={title}
      className={[
        'p-1.5 rounded transition-colors',
        call ? 'text-ink-dim cursor-not-allowed' : 'text-ink-muted hover:text-ink hover:bg-bg-raised',
      ].join(' ')}
    >
      <PhoneIcon />
    </button>
  )
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  )
}
