import { createContext, useContext, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import ServerRail from './ServerRail'
import DMsSidebar from './DMsSidebar'
import ChannelSidebar from './ChannelSidebar'

const ShellContext = createContext({ openDrawer: () => {}, closeDrawer: () => {} })
export const useShell = () => useContext(ShellContext)

export default function AppShell() {
  const loc = useLocation()
  const onGroups = loc.pathname.startsWith('/g/')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Auto-close the mobile drawer whenever the route changes
  useEffect(() => { setDrawerOpen(false) }, [loc.pathname])

  // Lock body scroll when drawer is open on mobile
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawerOpen])

  return (
    <ShellContext.Provider value={{
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
    }}>
      <div className="h-dvh flex bg-bg-main text-ink overflow-hidden relative">
        {/* Mobile/tablet backdrop */}
        {drawerOpen && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="lg:hidden fixed inset-0 bg-black/55 backdrop-blur-sm z-40"
          />
        )}

        {/* Rail + sidebar — slide-in drawer on < lg, static on lg+ */}
        <div
          className={[
            'flex h-full shrink-0',
            // mobile/tablet: fixed overlay, slide based on drawerOpen
            'fixed inset-y-0 left-0 z-50 transition-transform duration-200 will-change-transform',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
            // desktop: static and always visible
            'lg:static lg:translate-x-0 lg:z-auto lg:transition-none',
          ].join(' ')}
        >
          <ServerRail />
          {onGroups ? <ChannelSidebar /> : <DMsSidebar />}
        </div>

        <Outlet />
      </div>
    </ShellContext.Provider>
  )
}

// Reusable hamburger button — main view headers render it on small screens.
export function MenuButton({ className = '' }) {
  const { openDrawer } = useShell()
  return (
    <button
      onClick={openDrawer}
      className={`lg:hidden text-ink-muted hover:text-ink p-1.5 -ml-1 rounded hover:bg-bg-raised transition-colors ${className}`}
      title="Open menu"
      aria-label="Open menu"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
  )
}
