import Modal from './Modal'
import { usePrefs } from '../lib/usePrefs'
import { isMacPlatform, keyLabels, shortcutGroups } from '../lib/shortcuts'

const platform = () => (typeof navigator === 'undefined' ? '' : navigator.userAgentData?.platform || navigator.platform || '')

function Keys({ keys, mac }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keyLabels(keys, mac).map((k, i) => (
        <kbd
          key={i}
          className="min-w-[1.5rem] px-1.5 py-0.5 rounded border border-line-strong bg-bg-deepest text-[11px] font-medium text-ink-muted text-center"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}

/**
 * The list of keyboard shortcuts, opened with "?" (ShortcutsHelpHost) or from the
 * preferences. Loaded on first use. What it lists is src/lib/shortcuts.js.
 */
export default function ShortcutsHelp({ onClose }) {
  const [{ sendKey }] = usePrefs()
  const mac = isMacPlatform(platform())
  const groups = shortcutGroups({ sendKey })

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg">
      <div className="p-6" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 id="shortcuts-title" className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-dim hover:text-ink text-xl leading-none px-1">×</button>
        </div>
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim mb-2">{g.title}</h3>
              <ul className="space-y-2">
                {g.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-ink">{it.does}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <Keys keys={it.keys} mac={mac} />
                      {it.or && (<><span className="text-xs text-ink-dim">or</span><Keys keys={it.or} mac={mac} /></>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  )
}
