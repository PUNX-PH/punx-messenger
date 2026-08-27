import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth, channelViewer } from '../lib/auth'
import { listenChannels } from '../lib/groups'

/**
 * Lands on /g/:groupId — auto-redirect to the first channel.
 */
export default function GroupHome() {
  const { groupId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  const [empty, setEmpty] = useState(false)

  // No group document here — this view only redirects into the first channel,
  // so a group admin missing the private leg lands on a public channel instead
  // of a private one, which is no loss.
  const viewer = channelViewer(profile, null)

  useEffect(() => {
    setError(null)
    setEmpty(false)
    if (!groupId || !profile) return
    return listenChannels(
      groupId,
      (chs) => {
        if (chs.length > 0) navigate(`/g/${groupId}/c/${chs[0].id}`, { replace: true })
        else setEmpty(true)
      },
      (err) => setError(
        err?.code === 'permission-denied'
          ? "You don't have access to this group (or it no longer exists)."
          : err?.message || 'Failed to open this group.'
      ),
      // The unfiltered query is denied to guests and to members of a group
      // that has a private channel, so this redirect would never fire for
      // them. See listenChannels.
      viewer,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, viewer.uid, viewer.guest, viewer.seesPrivate, navigate])

  return (
    <main className="flex-1 grid place-items-center bg-bg-main">
      <div className="text-center max-w-md px-6 text-ink-muted text-sm">
        {error ? error : empty ? 'This group has no channels yet.' : 'Opening group…'}
      </div>
    </main>
  )
}
