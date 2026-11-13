import { useState } from 'react'
import { addExistingMembers, previewExistingMembers } from '../lib/onboardingApi'
import { namesLine, previewText, resultText } from '../lib/onboarding'

/**
 * "Team group": puts everyone who was here before new accounts started joining on their
 * own (src/lib/onboarding.js) into the team group, once. Two steps, so nothing changes by
 * accident: first a preview of who would be added, then a confirmation. Shown to the
 * people the Worker lets through (developers and super admins); the Worker checks again.
 */
export default function TeamGroupAdmin() {
  // idle -> checking -> preview -> adding -> done, with 'error' from either request.
  const [phase, setPhase] = useState('idle')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const check = async () => {
    setPhase('checking'); setError('')
    try { setPreview(await previewExistingMembers()); setPhase('preview') }
    catch (e) { setError(e?.message || 'Something went wrong.'); setPhase('error') }
  }
  const add = async () => {
    setPhase('adding'); setError('')
    try { setResult(await addExistingMembers()); setPhase('done') }
    catch (e) { setError(e?.message || 'Something went wrong.'); setPhase('error') }
  }
  const reset = () => { setPhase('idle'); setPreview(null); setResult(null); setError('') }

  const busy = phase === 'checking' || phase === 'adding'
  const primary = 'px-3 py-1.5 text-sm rounded-md bg-brand text-white hover:bg-brand-hover disabled:opacity-50 transition-colors'
  const secondary = 'px-3 py-1.5 text-sm rounded-md bg-bg-raised text-ink hover:bg-bg-hover border border-line-subtle disabled:opacity-50'

  return (
    <section className="mt-6" aria-labelledby="team-group-heading">
      <h2 id="team-group-heading" className="text-sm font-semibold text-ink-muted">Team group</h2>
      <p className="text-xs text-ink-dim mt-1">
        New company accounts join the team group on their own. This adds everyone who was here
        before that, once. You see who would be added first, and nothing changes until you confirm.
      </p>

      <div className="mt-3" aria-live="polite">
        {phase === 'idle' && (
          <button type="button" onClick={check} className={secondary}>See who would be added</button>
        )}
        {phase === 'checking' && <div className="text-sm text-ink-dim">Checking…</div>}

        {(phase === 'preview' || phase === 'adding') && preview && (
          <div className="text-sm">
            <div className="text-ink">{previewText(preview)}</div>
            {preview.toAdd > 0 && (
              <div className="mt-1 text-xs text-ink-dim break-words">{namesLine(preview.names, preview.toAdd)}</div>
            )}
            <div className="mt-3 flex items-center gap-2">
              {preview.toAdd > 0 && (
                <button type="button" onClick={add} disabled={busy} className={primary}>
                  {phase === 'adding' ? 'Adding…' : `Add ${preview.toAdd} ${preview.toAdd === 1 ? 'person' : 'people'}`}
                </button>
              )}
              <button type="button" onClick={reset} disabled={busy} className={secondary}>
                {preview.toAdd > 0 ? 'Cancel' : 'Close'}
              </button>
            </div>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="text-sm">
            <div className="text-ink">{resultText(result)}</div>
            <button type="button" onClick={reset} className={`${secondary} mt-3`}>Close</button>
          </div>
        )}

        {phase === 'error' && (
          <div role="alert" className="text-sm">
            <div className="text-ink-muted">{error}</div>
            <button type="button" onClick={reset} className={`${secondary} mt-3`}>Try again</button>
          </div>
        )}
      </div>
    </section>
  )
}
