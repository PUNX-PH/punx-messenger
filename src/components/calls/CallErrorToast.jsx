import { useCall } from '../../lib/useCall'

/**
 * Surfaces connError when there's no active call to show it inside (i.e.
 * CallOverlay isn't mounted) — e.g. getUserMedia/createCall/a Firestore
 * listener failed before any call doc existed. Without this, an error from
 * lib/useCall.jsx was set in state but never rendered anywhere, which is
 * exactly what made "I granted permission and nothing happened" impossible
 * to diagnose from the UI alone.
 */
export default function CallErrorToast() {
  const { call, connError, clearConnError } = useCall()
  if (!connError || call) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] max-w-md w-[calc(100%-2rem)]">
      <div className="bg-bad/95 text-white text-sm rounded-lg shadow-elev2 px-4 py-3 flex items-start gap-3">
        <span className="flex-1">{connError}</span>
        <button
          onClick={clearConnError}
          className="shrink-0 text-white/80 hover:text-white font-medium"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
