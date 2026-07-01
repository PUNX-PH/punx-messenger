export default function Avatar({ name, src, size = 32, status, ringColor = 'border-bg-dark', className = '' }) {
  const s = { width: size, height: size, fontSize: Math.round(size * 0.42) }

  const dot =
    status === 'online' ? 'bg-ok'
      : status === 'away' ? 'bg-warn'
      : status === 'offline' ? 'bg-ink-dim'
      : null

  const dotSize = Math.max(8, Math.round(size * 0.30))

  const inner = src ? (
    <img src={src} alt="" style={s} className={`rounded-full object-cover bg-bg-raised block ${className}`} />
  ) : (
    <div style={s} className={`rounded-full bg-brand grid place-items-center font-semibold text-white ${className}`}>
      {(name || '?').trim()[0]?.toUpperCase() || '?'}
    </div>
  )

  if (!dot) return inner

  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {inner}
      <span
        aria-hidden="true"
        className={`absolute rounded-full ${dot} border-[2px] ${ringColor}`}
        style={{
          width: dotSize,
          height: dotSize,
          right: -Math.round(dotSize * 0.1),
          bottom: -Math.round(dotSize * 0.1),
        }}
      />
    </span>
  )
}
