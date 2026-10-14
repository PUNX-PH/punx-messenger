import { Component } from 'react'

/**
 * Keeps one component's crash from taking the whole app with it.
 *
 * Without this, an exception while rendering unmounts the entire React tree. The
 * case that matters: one message whose fields are the wrong type renders fine
 * for its author and throws for everyone else, and since the throw happens while
 * the channel is open, nobody — admins included — can open the channel to delete
 * the offending message.
 *
 * `resetKey` clears a caught error when it changes, so moving to another
 * conversation gives it a fresh try rather than leaving the panel stuck.
 * `fullscreen` is for the outermost use, where there is no surrounding layout.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    const { title = "This couldn't be shown", fullscreen = false } = this.props
    return (
      <div
        role="alert"
        className={[
          'grid place-items-center px-6 bg-bg-main text-ink',
          fullscreen ? 'min-h-screen' : 'flex-1',
        ].join(' ')}
      >
        <div className="max-w-sm text-center">
          <div className="text-lg font-semibold mb-1">{title}</div>
          <p className="text-sm text-ink-muted mb-4">
            {fullscreen
              ? 'The app hit an unexpected error. Reloading usually fixes it.'
              : 'Something in here hit an error. The rest of the app still works — you can try again or open another conversation.'}
          </p>
          <button
            type="button"
            onClick={() => (fullscreen ? window.location.reload() : this.setState({ error: null }))}
            className="px-4 py-1.5 rounded-md bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
          >
            {fullscreen ? 'Reload' : 'Try again'}
          </button>
        </div>
      </div>
    )
  }
}
