import { useAuth } from '../lib/auth'
import { MenuButton } from '../components/AppShell'

export default function DMsHome() {
  const { profile } = useAuth()
  return (
    <main className="flex-1 flex flex-col bg-bg-main">
      <header className="h-12 border-b border-line-subtle flex items-center px-3 md:px-4 gap-2 shadow-elev1">
        <MenuButton />
        <FriendsIcon />
        <span className="font-semibold">Friends</span>
      </header>
      <div className="flex-1 grid place-items-center">
        <div className="text-center max-w-md px-6">
          <div className="text-2xl font-bold tracking-tight text-ink mb-2">
            Hey {profile?.name?.split(' ')[0] || 'there'} 👋
          </div>
          <p className="text-sm text-ink-muted">
            Pick a teammate from the left to start a direct message. Your private notes live in <span className="text-ink">My Notes</span>.
          </p>
        </div>
      </div>
    </main>
  )
}

function FriendsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-dim" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
