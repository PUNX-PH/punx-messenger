import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { listenChannels } from '../lib/groups'

/**
 * Lands on /g/:groupId — auto-redirect to the first channel.
 */
export default function GroupHome() {
  const { groupId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!groupId || !profile) return
    return listenChannels(groupId, (chs) => {
      if (chs.length > 0) navigate(`/g/${groupId}/c/${chs[0].id}`, { replace: true })
    })
  }, [groupId, profile, navigate])

  return (
    <main className="flex-1 grid place-items-center bg-bg-main">
      <div className="text-center max-w-md px-6 text-ink-muted text-sm">
        Opening group…
      </div>
    </main>
  )
}
