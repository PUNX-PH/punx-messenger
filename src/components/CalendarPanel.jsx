import { useEffect, useMemo, useRef, useState } from 'react'
import { calendarCache } from '../lib/dtrCalendarApi'
import {
  HOLIDAY_TYPES, WEEKDAY_LABELS, addMonths, dayLabel, eventsForDate, holidaysByDate, leaveCountLabel, leaveLine,
  monthGrid, monthKeyOf, monthTitle, toYMD,
} from '../lib/dtrCalendar'

/**
 * The calendar itself: the DTR company calendar (holidays, and who is on leave) for
 * one month, with the details of the chosen day underneath. Loaded on demand and shown
 * by CalendarHost. Unpinned it is a popup (closes on Escape and on a click outside);
 * pinned it stays where it is while you move between chats, and only its own buttons
 * close it.
 */
export default function CalendarPanel({ pinned, onTogglePin, onClose }) {
  const today = toYMD(new Date())
  const [month, setMonth] = useState(() => monthKeyOf(new Date()))
  const [selected, setSelected] = useState(today)
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const ref = useRef(null)

  useEffect(() => {
    let cancelled = false
    const cached = calendarCache.peek(month)
    setState(cached ? { status: 'ready', data: cached, error: null } : { status: 'loading', data: null, error: null })
    if (!cached) {
      calendarCache.get(month, { force: attempt > 0 }).then(
        (data) => { if (!cancelled) setState({ status: 'ready', data, error: null }) },
        (error) => { if (!cancelled) setState({ status: 'error', data: null, error }) },
      )
    }
    return () => { cancelled = true }
  }, [month, attempt])

  // A popup closes on Escape and on a click outside it; a pinned calendar does neither.
  useEffect(() => {
    if (pinned) return
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [pinned, onClose])

  const data = state.data
  const grid = useMemo(() => monthGrid(month), [month])
  const holidayIndex = useMemo(() => holidaysByDate(data?.holidays || []), [data])
  const leaves = data?.leaves || []
  const detail = eventsForDate(selected, { holidayIndex, leaves })

  const go = (n) => setMonth(m => addMonths(m, n))
  const goToday = () => { setMonth(monthKeyOf(new Date())); setSelected(today) }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Calendar"
      className="fixed right-3 top-14 z-40 w-[22rem] max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-4.5rem)] overflow-y-auto scrollbar-thin bg-bg-raised border border-line-subtle rounded-xl shadow-elev2"
    >
      <div className="flex items-center gap-1 px-3 py-2.5 border-b border-line-subtle bg-bg-deepest">
        <button type="button" onClick={() => go(-1)} aria-label="Previous month" className={iconBtn}><Chevron dir="left" /></button>
        <div className="flex-1 text-center text-sm font-semibold" aria-live="polite">{monthTitle(month)}</div>
        <button type="button" onClick={() => go(1)} aria-label="Next month" className={iconBtn}><Chevron dir="right" /></button>
        <button type="button" onClick={goToday} className="ml-1 px-2 py-1 rounded text-xs text-ink-muted hover:text-ink hover:bg-bg-hover">Today</button>
        <button
          type="button" onClick={onTogglePin} aria-pressed={pinned}
          aria-label={pinned ? 'Unpin the calendar' : 'Keep the calendar open'}
          title={pinned ? 'Pinned: stays open while you chat. Click to unpin.' : 'Keep open while you chat'}
          className={[iconBtn, pinned ? 'bg-bg-hover text-brand-text' : ''].join(' ')}
        >
          <Lock locked={pinned} />
        </button>
        <button type="button" onClick={onClose} aria-label="Close the calendar" className={iconBtn}><Close /></button>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-7 text-center text-[11px] text-ink-dim mb-1">
          {WEEKDAY_LABELS.map(d => <div key={d}>{d.slice(0, 2)}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5" role="grid" aria-label={monthTitle(month)}>
          {grid.map(c => {
            const ev = eventsForDate(c.ymd, { holidayIndex, leaves })
            const isToday = c.ymd === today
            const isSel = c.ymd === selected
            return (
              <button
                key={c.ymd} type="button" role="gridcell" aria-selected={isSel}
                aria-label={`${dayLabel(c.ymd)}${ev.holidays.length ? ', holiday' : ''}${ev.leaves.length ? `, ${ev.leaves.length} on leave` : ''}`}
                onClick={() => setSelected(c.ymd)}
                className={[
                  'h-9 rounded-md flex flex-col items-center justify-center text-xs transition-colors',
                  isSel ? 'bg-brand text-white font-semibold' : 'hover:bg-bg-hover',
                  !isSel && !c.inMonth ? 'text-ink-dim opacity-60' : '',
                  isToday && !isSel ? 'ring-1 ring-brand' : '',
                ].join(' ')}
              >
                <span>{c.day}</span>
                <span className="flex items-center gap-0.5 h-3.5 mt-0.5" aria-hidden="true">
                  {ev.holidays.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-warn" />}
                  {ev.leaves.length > 0 && (leaveCountLabel(ev.leaves.length)
                    ? (
                      <span className={['min-w-[0.875rem] h-3.5 px-0.5 rounded-full flex items-center justify-center text-[10px] font-bold leading-none', isSel ? 'bg-white text-brand' : 'bg-brand text-white'].join(' ')}>
                        {leaveCountLabel(ev.leaves.length)}
                      </span>
                    )
                    : <span className={['w-1.5 h-1.5 rounded-full', isSel ? 'bg-white' : 'bg-brand'].join(' ')} />)}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex gap-4 mt-2 text-[11px] text-ink-dim" aria-hidden="true">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-warn" />Holiday</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-brand" />On leave</span>
        </div>

        <div className="mt-3 pt-3 border-t border-line-subtle min-h-[4.5rem]" aria-live="polite">
          {state.status === 'loading' && <div className="text-sm text-ink-dim">Loading…</div>}
          {state.status === 'error' && (
            <div role="alert" className="text-sm">
              <div className="text-ink-muted">{state.error?.message || "Couldn't load the calendar."}</div>
              {state.error?.detail && <div className="mt-1 text-xs text-ink-dim break-words">{state.error.detail}</div>}
              {state.error?.retryable !== false && (
                <button type="button" onClick={() => setAttempt(a => a + 1)} className="mt-2 text-xs text-brand-text hover:underline">Try again</button>
              )}
            </div>
          )}
          {state.status === 'ready' && (
            <>
              <div className="text-sm font-semibold mb-1.5">{dayLabel(selected)}</div>
              {detail.holidays.length === 0 && detail.leaves.length === 0 && (
                <div className="text-sm text-ink-dim">Nothing on this day.</div>
              )}
              {detail.holidays.map(h => (
                <div key={h.id + h.day} className="text-sm mb-1">
                  <span className="font-medium">{h.name}</span>
                  <span className="text-ink-dim"> · {HOLIDAY_TYPES[h.type]?.label || 'Holiday'}{h.days > 1 ? ` (day ${h.day} of ${h.days})` : ''}</span>
                </div>
              ))}
              {detail.leaves.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {detail.leaves.map(l => (
                    <li key={l.id} className="text-sm flex justify-between gap-3">
                      <span className="truncate">{leaveLine(l)}</span>
                      {data.departments?.[l.departmentId] && <span className="text-xs text-ink-dim shrink-0">{data.departments[l.departmentId]}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const iconBtn = 'p-1.5 rounded text-ink-muted hover:text-ink hover:bg-bg-hover transition-colors'

function Svg({ children, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
const Chevron = ({ dir }) => <Svg><path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></Svg>
const Close = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>
const Lock = ({ locked }) => (
  <Svg>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d={locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.5-2'} />
  </Svg>
)
