import { useEffect } from 'react'
import { useUnreadCount } from '../lib/useUnreadCount'
import { titleWithCount } from '../lib/unread'

// The title the page was given, remembered once: read back from the tab after the
// first update it would already have a count in it.
let baseTitle = null

/**
 * Puts the number of conversations with something new in the browser tab's title,
 * "(3) Punx Messenger", so it is visible from another tab, in the window list and
 * in the taskbar. Renders nothing. Mounted once, beside the routes, while signed in.
 */
export default function TabTitleUnread() {
  const count = useUnreadCount()

  useEffect(() => {
    baseTitle ??= document.title.replace(/^\(\d+\+?\)\s+/, '')
    document.title = titleWithCount(baseTitle, count)
  }, [count])

  // Back to plain when signed out or unmounted, so the login page never says "(3)".
  useEffect(() => () => {
    if (baseTitle) document.title = baseTitle
  }, [])

  return null
}
