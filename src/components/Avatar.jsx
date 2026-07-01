export default function Avatar({ name, src, size = 32, className = '' }) {
  const s = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  if (src) {
    return <img src={src} alt="" style={s} className={`rounded-full object-cover bg-bg-raised ${className}`} />
  }
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?'
  return (
    <div
      style={s}
      className={`rounded-full bg-brand grid place-items-center font-semibold text-white shrink-0 ${className}`}
    >
      {initial}
    </div>
  )
}
