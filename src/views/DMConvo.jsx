import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUsers } from '../lib/users'
import { dmConvoId, ensureDmConvo } from '../lib/db'
import ChatSurface from '../components/ChatSurface'
import Loading from '../components/Loading'
import CallButtons from '../components/calls/CallButtons'

export default function DMConvo() {
  const { otherUid } = useParams()
  const { profile } = useAuth()
  const { users, byId } = useUsers()
  const other = byId[otherUid] || null
  const [convoReady, setConvoReady] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setConvoReady(false)
    setError(null)
    if (!profile || !other) return
    let cancelled = false
    ;(async () => {
      try {
        await ensureDmConvo(profile, other)
        if (!cancelled) setConvoReady(true)
      } catch (e) {
        console.error('[DMConvo] failed to open:', e)
        if (!cancelled) setError(e?.code === 'permission-denied'
          ? "Couldn't open this DM. Try re-publishing your Firestore rules with the non-existent-doc read fix."
          : e?.message || 'Failed to open DM.')
      }
    })()
    return () => { cancelled = true }
    // `other` is deliberately not a dependency — useUsers() hands back a
    // fresh object reference on every presence tick, and re-running this
    // (re-ensuring the DM convo, resetting to "Opening DM…") on every
    // teammate's heartbeat is what caused the flicker. Re-run only when the
    // *availability* of `other` changes (roster loads), not its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherUid, profile, Boolean(other)])

  if (error) return <Center>{error}</Center>
  if (!other) return <Center>{users.length ? "That teammate doesn't exist." : 'Loading conversation…'}</Center>
  if (!convoReady) return <Center>Opening DM…</Center>

  const path = `dms/${dmConvoId(profile.uid, other.id)}/messages`

  return (
    <ChatSurface
      title={other.name}
      icon="@"
      path={path}
      canPin
      composerPlaceholder={`Message @${other.name}`}
      empty={{
        title: `This is the start of your conversation with ${other.name}.`,
        desc: 'Only the two of you can see these messages.',
      }}
      headerExtras={<CallButtons otherUid={other.id} />}
    />
  )
}

function Center({ children }) {
  return (
    <main className="flex-1 grid place-items-center bg-bg-main text-ink-muted text-sm">
      {children}
    </main>
  )
}
