import { useEffect, useState } from 'react'
import LazySlot from './LazySlot'
import { ShortcutsHelp } from '../lib/lazyParts'
import { OPEN_SHORTCUTS_EVENT, shouldOpenHelp } from '../lib/shortcuts'

/**
 * Shows the keyboard shortcuts on "?" (when not typing in a text field), or when the
 * preferences ask for it. Renders nothing until then; the sheet itself is loaded on
 * first use. Mounted once, beside the routes, while signed in.
 */
export default function ShortcutsHelpHost() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (!shouldOpenHelp(e)) return
      e.preventDefault()
      setOpen(o => !o)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen)
    }
  }, [])

  if (!open) return null
  return (
    <LazySlot overlay title="The shortcuts list couldn't be opened" onDismiss={() => setOpen(false)}>
      <ShortcutsHelp onClose={() => setOpen(false)} />
    </LazySlot>
  )
}
