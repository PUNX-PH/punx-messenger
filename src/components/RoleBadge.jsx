export default function RoleBadge({ role, size = 'sm' }) {
  if (!role || role === 'employee') return null

  const cfg = {
    super_admin: { label: 'Super admin', cls: 'bg-warn/15 text-warn border-warn/30' },
    admin:       { label: 'Admin',       cls: 'bg-brand/15 text-brand border-brand/30' },
  }[role]
  if (!cfg) return null

  const sz = size === 'xs' ? 'text-[9px] px-1 py-px' : 'text-[10px] px-1.5 py-0.5'
  return (
    <span className={`inline-flex items-center rounded border font-semibold uppercase tracking-wider ${sz} ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}
