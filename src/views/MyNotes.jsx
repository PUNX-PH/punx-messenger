import { useAuth } from '../lib/auth'
import ChatSurface from '../components/ChatSurface'

export default function MyNotes() {
  const { profile } = useAuth()
  if (!profile) return null
  const path = `users/${profile.id}/notes`
  return (
    <ChatSurface
      title="My Notes"
      icon="✎"
      path={path}
      canPin
      composerPlaceholder="Jot something down…"
      empty={{
        title: 'Your private notes',
        desc: 'Only you can see these. Save messages here with the bookmark button, or use it as a scratch pad: links, todos, anything.',
      }}
    />
  )
}
