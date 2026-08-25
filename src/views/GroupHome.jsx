import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth, isGuest } from '../lib/auth'
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
      // Guests can only query channels that name them; the unfiltered query
      // would be denied and they'd never reach the channel they were invited
      // to. See listenChannels.
      isGuest(profile) ? profile?.id : null,
    )
  }, [groupId, profile, navigate])

  return (
    <main className="flex-1 grid place-items-center bg-bg-main">
      <div className="text-center max-w-md px-6 text-ink-muted text-sm">
        {error ? error : empty ? 'This group has no channels yet.' : 'Opening group…'}
      </div>
    </main>
  )
}
