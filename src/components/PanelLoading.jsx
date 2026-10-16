/**
 * What fills a screen's space while a lazily loaded screen arrives. Sized to the
 * space it will occupy (not the whole viewport, like Loading), so the sidebars
 * around it stay put instead of the layout jumping.
 */
export default function PanelLoading({ label = 'Loading' }) {
  return (
    <div className="flex-1 grid place-items-center bg-bg-main text-ink-muted text-sm" role="status">
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
        {label}
      </div>
    </div>
  )
}
