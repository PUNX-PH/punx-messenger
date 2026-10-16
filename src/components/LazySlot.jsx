import { Component, Suspense } from 'react'
import { isChunkLoadError } from '../lib/lazy'

/**
 * Wraps a part of the app that loads on demand: shows `fallback` while it loads,
 * and, if it cannot be loaded, says so without disturbing anything else.
 *
 * The thing to avoid is the failure reaching the app's top-level error boundary,
 * which replaces everything — and so ends a call or voice session in progress —
 * just because a settings dialog's file was missing. This catches it first.
 *
 *   <LazySlot overlay onDismiss={close}>   a dialog or popover: a small notice at
 *                                          the bottom. `onDismiss` lets the parent
 *                                          mark it closed when the notice is dismissed.
 *   <LazySlot>                             a screen: a panel inside the layout
 *
 * Two different failures, two different buttons. If the FILE could not be loaded
 * (offline, or the app was updated since this tab opened and the old file is
 * gone), only a reload helps: React.lazy remembers a failed load for good, so
 * "try again" would just replay it. If the part loaded and then crashed while
 * rendering, trying again is exactly right.
 */
export default function LazySlot({ children, fallback = null, overlay = false, title, onDismiss }) {
  return (
    <LazyBoundary overlay={overlay} title={title} onDismiss={onDismiss}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </LazyBoundary>
  )
}

class LazyBoundary extends Component {
  state = { error: null, dismissed: false }

  static getDerivedStateFromError(error) {
    return { error }
  }

  // Dismissing must STOP rendering the children, not just clear the error: a file
  // that failed to load fails again on the very next render (React.lazy remembers),
  // so clearing the error alone brought the notice straight back.
  dismiss = () => {
    this.setState({ dismissed: true })
    this.props.onDismiss?.()
  }

  componentDidCatch(error) {
    console.error('[LazySlot]', error)
  }

  render() {
    const { error, dismissed } = this.state
    if (dismissed) return null
    if (!error) return this.props.children

    const { overlay, title = "This couldn't be opened" } = this.props
    const fileFailed = isChunkLoadError(error)
    const message = fileFailed
      ? "Couldn't load this. You may be offline, or the app has been updated since this tab was opened."
      : 'Something went wrong opening this.'
    const action = fileFailed
      ? { label: 'Reload', run: () => window.location.reload() }
      : { label: 'Try again', run: () => this.setState({ error: null }) }

    const button = (
      <button
        type="button"
        onClick={action.run}
        className="shrink-0 rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-hover transition-colors"
      >
        {action.label}
      </button>
    )

    if (overlay) {
      return (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] max-w-[calc(100vw-2rem)] flex items-center gap-3 rounded-lg border border-line-subtle bg-bg-raised px-4 py-3 text-sm text-ink shadow-elev2"
        >
          <span className="min-w-0">{message}</span>
          {button}
          <button
            type="button"
            onClick={this.dismiss}
            aria-label="Dismiss"
            className="shrink-0 text-ink-dim hover:text-ink transition-colors"
          >
            ×
          </button>
        </div>
      )
    }

    return (
      <div role="alert" className="flex-1 grid place-items-center px-6 bg-bg-main text-ink">
        <div className="max-w-sm text-center">
          <div className="text-lg font-semibold mb-1">{title}</div>
          <p className="text-sm text-ink-muted mb-4">{message}</p>
          {button}
        </div>
      </div>
    )
  }
}
