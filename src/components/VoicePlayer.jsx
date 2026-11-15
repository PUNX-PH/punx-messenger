import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../lib/voiceMessage'

// Only one voice message plays at a time: starting one stops the one before it.
let playing = null

/**
 * A voice message in the list: a play/pause button, how far along it is (drag to move), and the
 * time. `audio` is { url, durationMs } from audioOf(), already checked; nothing else is ever played.
 * The length stored with the message is used until the file says its own (some recorders write a
 * file whose length the browser cannot know until it has played).
 */
export default function VoicePlayer({ audio }) {
  const ref = useRef(null)
  const [on, setOn] = useState(false)
  const [at, setAt] = useState(0) // seconds played
  const [total, setTotal] = useState(audio.durationMs / 1000)
  const [failed, setFailed] = useState(false)

  useEffect(() => () => { if (playing === ref.current) playing = null }, [])

  const toggle = async () => {
    const el = ref.current
    if (!el) return
    if (!el.paused) { el.pause(); return }
    if (playing && playing !== el) playing.pause()
    playing = el
    try { await el.play() } catch { setFailed(true); setOn(false) }
  }

  const shown = Number.isFinite(total) && total > 0 ? total : audio.durationMs / 1000
  const label = on || at > 0 ? `${formatDuration(at * 1000)} / ${formatDuration(shown * 1000)}` : formatDuration(shown * 1000)

  return (
    <div className="mt-1 inline-flex items-center gap-2 max-w-full bg-bg-deepest border border-line-subtle rounded-full pl-1.5 pr-3 py-1 text-sm" role="group" aria-label="Voice message">
      <button
        type="button"
        onClick={toggle}
        title={on ? 'Pause' : 'Play'}
        aria-label={on ? 'Pause voice message' : 'Play voice message'}
        className="w-7 h-7 shrink-0 grid place-items-center rounded-full bg-brand text-white hover:bg-brand-hover transition-colors"
      >
        {on
          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>}
      </button>
      <input
        type="range"
        min="0"
        max={shown || 1}
        step="0.1"
        value={Math.min(at, shown || 1)}
        onChange={(e) => { const v = Number(e.target.value); setAt(v); if (ref.current) ref.current.currentTime = v }}
        aria-label="Position in the voice message"
        className="w-32 sm:w-44 accent-[var(--brand,#5865f2)]"
      />
      <span className="text-xs text-ink-muted tabular-nums shrink-0">{failed ? "Can't play" : label}</span>
      <audio
        ref={ref}
        src={audio.url}
        preload="metadata"
        onPlay={() => setOn(true)}
        onPause={() => setOn(false)}
        onEnded={() => { setOn(false); setAt(0) }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setTotal(d) }}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
