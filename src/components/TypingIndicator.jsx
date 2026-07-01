export default function TypingIndicator({ names }) {
  if (!names || names.length === 0) {
    // Keep space reserved so the composer doesn't jump when someone starts typing
    return <div className="h-4" />
  }

  let text
  if (names.length === 1) text = <><strong className="text-ink font-medium">{names[0]}</strong> is typing</>
  else if (names.length === 2) text = <><strong className="text-ink font-medium">{names[0]}</strong> and <strong className="text-ink font-medium">{names[1]}</strong> are typing</>
  else text = <><strong className="text-ink font-medium">{names[0]}</strong>, <strong className="text-ink font-medium">{names[1]}</strong>, and {names.length - 2} other{names.length - 2 === 1 ? '' : 's'} are typing</>

  return (
    <div className="h-4 px-1 text-xs text-ink-muted flex items-center gap-1">
      <Dots />
      <span>{text}…</span>
    </div>
  )
}

function Dots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      <span className="w-1 h-1 rounded-full bg-ink-muted animate-typ" style={{ animationDelay: '0ms' }} />
      <span className="w-1 h-1 rounded-full bg-ink-muted animate-typ" style={{ animationDelay: '150ms' }} />
      <span className="w-1 h-1 rounded-full bg-ink-muted animate-typ" style={{ animationDelay: '300ms' }} />
      <style>{`
        @keyframes typ { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-1px); } }
        .animate-typ { animation: typ 1.1s ease-in-out infinite; }
      `}</style>
    </span>
  )
}
