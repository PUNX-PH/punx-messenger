import { useAuth, isAdmin } from '../lib/auth'

export default function AppShell() {
  const { profile, signOut } = useAuth()

  return (
    <div className="h-screen flex bg-bg-main text-ink">
      {/* Server / group rail */}
      <aside className="w-[72px] bg-bg-deepest flex flex-col items-center py-3 gap-2 border-r border-line-subtle">
        <RailItem active>P</RailItem>
        <div className="w-8 h-px bg-line-subtle my-1" />
        <RailItem>D</RailItem>
        <RailItem>E</RailItem>
        <RailItem add>+</RailItem>
      </aside>

      {/* Channel sidebar */}
      <aside className="w-60 bg-bg-dark flex flex-col border-r border-line-subtle">
        <div className="h-12 flex items-center px-4 border-b border-line-subtle shadow-elev1">
          <div className="text-sm font-semibold tracking-tight">Punx HQ</div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-0.5">
          <SectionLabel>Text channels</SectionLabel>
          <ChannelItem active>general</ChannelItem>
          <ChannelItem>announcements</ChannelItem>
          <ChannelItem>random</ChannelItem>
          <SectionLabel className="mt-4">Direct messages</SectionLabel>
          <ChannelItem dm>Rey</ChannelItem>
          <ChannelItem dm>My notes</ChannelItem>
        </div>
        <div className="h-14 bg-bg-deepest border-t border-line-subtle px-2 flex items-center gap-2">
          <Avatar name={profile?.name} src={profile?.photoURL} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{profile?.name}</div>
            <div className="text-xs text-ink-dim truncate">{roleLabel(profile?.role)}</div>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="text-ink-dim hover:text-ink p-1.5 rounded hover:bg-bg-hover transition-colors"
          >
            <SignOutIcon />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-line-subtle flex items-center px-4 gap-2 shadow-elev1">
          <span className="text-ink-dim">#</span>
          <span className="font-semibold">general</span>
          <span className="text-ink-dim text-sm ml-3 border-l border-line-subtle pl-3">
            Welcome to Punx HQ
          </span>
        </header>

        <div className="flex-1 grid place-items-center text-ink-muted">
          <div className="text-center max-w-md px-6">
            <div className="text-2xl font-bold tracking-tight text-ink mb-2">
              Hey {profile?.name?.split(' ')[0] || 'there'} 👋
            </div>
            <p className="text-sm">
              Channels, DMs, and groups are coming next. Right now you're signed in as{' '}
              <span className="text-ink">{profile?.email}</span> with role{' '}
              <span className="text-brand font-medium">{roleLabel(profile?.role)}</span>.
            </p>
          </div>
        </div>

        <div className="p-4">
          <div className="bg-bg-raised border border-line-subtle rounded-lg px-4 py-3 text-ink-muted text-sm">
            Message composer goes here — wiring it up in the next step.
          </div>
        </div>
      </main>
    </div>
  )
}

function RailItem({ children, active, add }) {
  return (
    <button
      className={[
        'group relative w-12 h-12 rounded-2xl grid place-items-center font-semibold transition-all duration-150',
        active
          ? 'bg-brand text-white rounded-xl'
          : add
            ? 'bg-bg-raised text-ok hover:bg-ok hover:text-white hover:rounded-xl'
            : 'bg-bg-raised text-ink hover:bg-brand hover:text-white hover:rounded-xl',
      ].join(' ')}
    >
      {children}
      {active && <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r" />}
    </button>
  )
}

function SectionLabel({ children, className = '' }) {
  return (
    <div className={`px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wider uppercase text-ink-dim ${className}`}>
      {children}
    </div>
  )
}

function ChannelItem({ children, active, dm }) {
  return (
    <button
      className={[
        'w-full text-left px-2 py-1.5 rounded-sm text-sm flex items-center gap-2 transition-colors duration-150',
        active
          ? 'bg-bg-hover text-ink'
          : 'text-ink-muted hover:bg-bg-raised hover:text-ink',
      ].join(' ')}
    >
      <span className="text-ink-dim">{dm ? '@' : '#'}</span>
      <span className="truncate">{children}</span>
    </button>
  )
}

function Avatar({ name, src }) {
  if (src) return <img src={src} alt="" className="w-8 h-8 rounded-full object-cover" />
  const initial = (name || '?').trim()[0]?.toUpperCase()
  return (
    <div className="w-8 h-8 rounded-full bg-brand grid place-items-center text-xs font-semibold text-white">
      {initial}
    </div>
  )
}

function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function roleLabel(r) {
  return r === 'super_admin' ? 'Super admin' : r === 'admin' ? 'Admin' : 'Employee'
}
