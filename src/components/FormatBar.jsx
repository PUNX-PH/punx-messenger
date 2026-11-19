import { FORMAT_BUTTONS } from '../lib/formatting'

// The buttons that format the selected text in the message box (bold, italic, strikethrough, code,
// spoiler). What they do is in lib/formatting.js; the box is told which one was pressed.
export default function FormatBar({ onFormat, disabled = false }) {
  return (
    <div className="mb-1.5 flex items-center gap-0.5" role="toolbar" aria-label="Format the selected text" data-format-bar>
      {FORMAT_BUTTONS.map(b => (
        <button
          key={b.name}
          type="button"
          disabled={disabled}
          // Pressing a button must not take the selection away from the box, or there would be
          // nothing left to format.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onFormat(b.name)}
          title={b.shortcut ? `${b.label} (Ctrl/⌘+${b.shortcut})` : b.label}
          aria-label={b.label}
          data-format={b.name}
          className="h-7 min-w-7 px-1.5 rounded grid place-items-center text-sm text-ink-muted hover:text-ink hover:bg-bg-hover transition-colors disabled:opacity-40"
        >
          <Glyph name={b.name} />
        </button>
      ))}
    </div>
  )
}

function Glyph({ name }) {
  if (name === 'bold') return <span className="font-bold" aria-hidden="true">B</span>
  if (name === 'italic') return <span className="italic font-serif" aria-hidden="true">I</span>
  if (name === 'strike') return <span className="line-through" aria-hidden="true">S</span>
  if (name === 'code') return <span className="font-mono text-xs" aria-hidden="true">{'</>'}</span>
  // spoiler: an eye with a line through it
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
