import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/auth'
import { dmConvoId, ensureDmConvo } from '../lib/db'
import ChatSurface from '../components/ChatSurface'
import Loading from '../components/Loading'

export default function DMConvo() {
  const { otherUid } = useParams()
  const { profile } = useAuth()
  const [other, setOther] = useState(null)
  const [convoReady, setConvoReady] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setConvoReady(false)
    setOther(null)
    setError(null)
    if (!profile || !otherUid) return
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'users', otherUid))
        if (cancelled) return
        if (!snap.exists()) { setOther({ notFound: true }); return }
        const o = { id: snap.id, ...snap.data() }
        setOther(o)
        await ensureDmConvo(profile, o)
        if (!cancelled) setConvoReady(true)
      } catch (e) {
        console.error('[DMConvo] failed to open:', e)
        if (!cancelled) setError(e?.code === 'permission-denied'
          ? "Couldn't open this DM. Try re-publishing your Firestore rules with the non-existent-doc read fix."
          : e?.message || 'Failed to open DM.')
      }
    })()
    return () => { cancelled = true }
  }, [otherUid, profile])

  if (error) return <Center>{error}</Center>
  if (!other) return <Center>Loading conversation…</Center>
  if (other.notFound) return <Center>That teammate doesn't exist.</Center>
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
