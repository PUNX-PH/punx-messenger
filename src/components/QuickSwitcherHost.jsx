import { useEffect, useState } from 'react'
import LazySlot from './LazySlot'
import { QuickSwitcher } from '../lib/lazyParts'
import { OPEN_EVENT } from '../lib/quickSwitch'

/**
 * Opens the "jump to a conversation" box on Ctrl+K (Cmd+K on a Mac), or when the
 * menu asks for it. Renders nothing until then; the box itself is loaded on first
 * use. Mounted once, beside the routes, while signed in.
 */
export default function QuickSwitcherHost() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        // Even in a text box (it is how Discord and Slack behave), and instead of the
        // browser's own use of the key, which is to focus its search bar.
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  if (!open) return null
  return (
    <LazySlot overlay title="The switcher couldn't be opened" onDismiss={() => setOpen(false)}>
      <QuickSwitcher onClose={() => setOpen(false)} />
    </LazySlot>
  )
}
