import { useEffect, useMemo } from 'react'

// The pictures waiting to be sent: a thumbnail each, with a way to take one back out.
export default function AttachmentTray({ files, onRemove, busy = false }) {
  // One preview address per file, released when the list changes or the tray goes.
  const urls = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach(u => URL.revokeObjectURL(u)), [urls])

  if (files.length === 0) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label={`${files.length} ${files.length === 1 ? 'picture' : 'pictures'} to send`} data-attachments>
      {files.map((f, i) => (
        <li key={`${f.name}:${f.size}:${f.lastModified}`} className="relative group bg-bg-raised border border-line-subtle rounded-md p-1.5 flex items-center gap-2" data-attachment>
          <img src={urls[i]} alt="" className="w-14 h-14 object-cover rounded" />
          <div className="text-xs text-ink-muted min-w-0">
            <div className="truncate max-w-[140px] text-ink">{f.name}</div>
            <div>{formatBytes(f.size)}</div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(i)}
            disabled={busy}
            className="text-ink-dim hover:text-bad p-1 disabled:opacity-40"
            title={`Remove ${f.name}`}
            aria-label={`Remove ${f.name}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  )
}

function formatBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
