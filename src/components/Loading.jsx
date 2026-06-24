export default function Loading({ label = 'Loading' }) {
  return (
    <div className="min-h-screen grid place-items-center bg-bg-deepest text-ink-muted text-sm">
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
        {label}
      </div>
    </div>
  )
}
