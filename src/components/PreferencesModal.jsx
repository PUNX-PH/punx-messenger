import { useId, useSyncExternalStore } from 'react'
import Modal from './Modal'
import { usePrefs, useSyncStatus } from '../lib/usePrefs'
import {
  ACCENTS, CONTRASTS, DEFAULT_ACCENT_HEX, DENSITIES, FONTS, GROUP_MINUTES, PALETTES, SEND_KEYS,
  TEXT_SIZES, THEMES, TIME_FORMATS, isDefault,
} from '../lib/prefs'
import { accentVars, surfacesFor } from '../lib/palettes'
import { rgbToHex } from '../lib/colorMath'
import { headerTime } from '../lib/timeFormat'
import { isEnabled as sfxEnabled, play as playSfx, setEnabled as setSfxEnabled, subscribe as sfxSubscribe } from '../lib/sfx'
import { useNotifications } from '../lib/notifications'

/**
 * Appearance and preferences. Every change applies the moment it is made (the whole
 * app behind this dialog changes with it) and is saved to the person's account, so
 * it follows them to their other devices. Nothing here needs a "Save" button.
 */
export default function PreferencesModal({ open, onClose }) {
  const [prefs, set, reset] = usePrefs()
  const sync = useSyncStatus()
  const sfxOn = useSyncExternalStore(sfxSubscribe, sfxEnabled, sfxEnabled)
  const { supported: notifSupported, permission: notifPerm, request: requestNotif } = useNotifications()

  const isPresetAccent = ACCENTS.some(a => a.hex === prefs.accent)
  const customSelected = prefs.accent !== null && !isPresetAccent

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <h2 className="text-lg font-semibold">Appearance &amp; preferences</h2>
            <p className="text-xs text-ink-dim mt-0.5">Changes apply right away and follow you to your other devices.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-dim hover:text-ink text-xl leading-none px-1">×</button>
        </div>

        <Preview prefs={prefs} />

        <Section title="Theme">
          <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
            {THEMES.map(t => (
              <button
                key={t.id} type="button" role="radio" aria-checked={prefs.theme === t.id}
                onClick={() => set({ theme: t.id })}
                className={cardClass(prefs.theme === t.id)}
              >
                <ThemeThumb mode={t.id} prefs={prefs} />
                <div className="text-sm font-medium mt-2">{t.label}</div>
                <div className="text-[11px] text-ink-dim">{t.hint}</div>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Background" note="Each background has a dark and a light shade; the theme above picks which one you see.">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2" role="radiogroup" aria-label="Background">
            {PALETTES.map(p => {
              const on = prefs.background === p.id
              return (
                <button
                  key={p.id} type="button" role="radio" aria-checked={on} onClick={() => set({ background: p.id })}
                  className={cardClass(on, 'p-1.5')}
                >
                  <span className="flex h-7 rounded overflow-hidden border border-black/20">
                    <span className="flex-1" style={{ background: rgbToHex(surfacesFor(p.id, 'dark').bgMain) }} />
                    <span className="flex-1" style={{ background: rgbToHex(surfacesFor(p.id, 'light').bgMain) }} />
                  </span>
                  <span className="block text-[11px] mt-1 text-left truncate">{on ? '✓ ' : ''}{p.label}</span>
                </button>
              )
            })}
          </div>
        </Section>

        <Section title="Accent colour" note="Buttons, links and highlights. Whatever you pick is adjusted just enough to stay readable.">
          <div className="flex flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Accent colour">
            <Dot label="Original" hex={DEFAULT_ACCENT_HEX} on={prefs.accent === null} onClick={() => set({ accent: null })} />
            {ACCENTS.map(a => (
              <Dot key={a.id} label={a.label} hex={a.hex} on={prefs.accent === a.hex} onClick={() => set({ accent: a.hex })} />
            ))}
            <label
              title="Choose your own colour"
              className={[
                'relative w-8 h-8 rounded-full grid place-items-center cursor-pointer shrink-0 focus-within:outline focus-within:outline-2 focus-within:outline-brand',
                customSelected ? 'ring-2 ring-offset-2 ring-ink ring-offset-bg-raised' : '',
              ].join(' ')}
              style={{ background: 'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)' }}
            >
              <span className="text-white text-sm font-bold drop-shadow" aria-hidden="true">{customSelected ? '✓' : '+'}</span>
              <span className="sr-only">Custom colour</span>
              <input
                type="color" aria-label="Custom accent colour"
                value={prefs.accent || DEFAULT_ACCENT_HEX}
                onChange={(e) => set({ accent: e.target.value })}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
          </div>
        </Section>

        <div className="grid sm:grid-cols-2 gap-x-8">
          <Section title="Text size">
            <Segmented label="Text size" value={prefs.textSize} options={TEXT_SIZES} onChange={(v) => set({ textSize: v })} />
          </Section>
          <Section title="Spacing" note="Compact fits more on screen by tightening messages and lists.">
            <Segmented label="Spacing" value={prefs.density} options={DENSITIES} onChange={(v) => set({ density: v })} />
          </Section>
        </div>

        <Section title="Font">
          <div className="grid sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Font">
            {FONTS.map(f => (
              <button
                key={f.id} type="button" role="radio" aria-checked={prefs.font === f.id} onClick={() => set({ font: f.id })}
                className={cardClass(prefs.font === f.id, 'p-3 text-left')}
              >
                <div className="text-sm font-medium">{f.label}</div>
                <div className="text-[11px] text-ink-dim">{f.hint}</div>
              </button>
            ))}
          </div>
        </Section>

        <div className="space-y-2 mt-5">
          <Switch
            label="Higher contrast" hint="Stronger text and borders, for easier reading."
            checked={prefs.contrast === 'high'} onChange={(on) => set({ contrast: on ? 'high' : 'normal' })}
          />
          <Switch
            label="Reduce motion" hint="Turns off pop-ins, wiggles and sliding. Always on if your device asks for less motion."
            checked={prefs.reduceMotion} onChange={(on) => set({ reduceMotion: on })}
          />
        </div>

        <h3 className="mt-8 mb-1 text-base font-semibold">Messages</h3>
        <div className="grid sm:grid-cols-2 gap-x-8">
          <Section title="Clock">
            <Segmented label="Clock" value={prefs.timeFormat} options={TIME_FORMATS} onChange={(v) => set({ timeFormat: v })} />
          </Section>
          <Section title="Group messages from the same person within">
            <Segmented label="Group messages within" value={prefs.groupMinutes} options={GROUP_MINUTES} onChange={(v) => set({ groupMinutes: v })} />
          </Section>
        </div>
        <Section title="Send a message with" note={SEND_KEYS.find(k => k.id === prefs.sendKey)?.hint}>
          <Segmented label="Send with" value={prefs.sendKey} options={SEND_KEYS} onChange={(v) => set({ sendKey: v })} />
        </Section>

        <h3 className="mt-8 mb-1 text-base font-semibold">Alerts</h3>
        <div className="space-y-2 mt-3">
          <Switch
            label="Unread count in the tab title" hint={'Shows "(3) Punx Messenger" so you can see it from another tab.'}
            checked={prefs.tabTitleCount} onChange={(on) => set({ tabTitleCount: on })}
          />
          <Switch
            label="Sound effects" hint="Calls, direct messages and people joining a voice channel. On this device only."
            checked={sfxOn}
            onChange={(on) => { setSfxEnabled(on); if (on) playSfx('dm_ping') }}
          />
          {notifSupported && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-line-subtle bg-bg-deepest px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Desktop notifications</div>
                <div className="text-xs text-ink-dim">
                  {notifPerm === 'granted' ? 'On for this browser.'
                    : notifPerm === 'denied' ? 'Blocked. Allow them for this site in your browser’s settings.'
                    : 'Get a pop-up for new messages when Punx is in the background.'}
                </div>
              </div>
              {notifPerm === 'default' && (
                <button type="button" onClick={requestNotif} className="shrink-0 bg-brand hover:bg-brand-hover text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors">
                  Turn on
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 mt-8 pt-4 border-t border-line-subtle">
          <div className="text-xs text-ink-dim" role="status" aria-live="polite">
            {sync === 'saving' ? 'Saving…'
              : sync === 'saved' ? 'Saved to your account.'
              : sync === 'error' ? 'Saved on this device only: couldn’t reach your account.'
              : 'Saved to your account, so it follows you to your other devices.'}
          </div>
          <button
            type="button" disabled={isDefault(prefs)}
            onClick={() => { if (confirm('Put every appearance and preference choice back to its default?')) reset() }}
            className="text-sm text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed underline-offset-2 hover:underline"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ───────── pieces ─────────

const cardClass = (on, extra = 'p-2') => [
  'rounded-lg border text-left transition-colors',
  on ? 'border-brand bg-brand/10 ring-1 ring-brand' : 'border-line-subtle bg-bg-deepest hover:border-line-strong',
  extra,
].join(' ')

function Section({ title, note, children }) {
  const id = useId()
  return (
    <section className="mt-5" aria-labelledby={id}>
      <h3 id={id} className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">{title}</h3>
      {children}
      {note && <p className="text-xs text-ink-dim mt-2">{note}</p>}
    </section>
  )
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 p-0.5 rounded-full border border-line-subtle bg-bg-deepest">
      {options.map(o => (
        <button
          key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={[
            'px-3 py-1 rounded-full text-sm transition-colors whitespace-nowrap',
            value === o.id ? 'bg-brand text-white font-medium' : 'text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Switch({ label, hint, checked, onChange }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-4 rounded-lg border border-line-subtle bg-bg-deepest px-4 py-3 text-left hover:border-line-strong transition-colors"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-dim">{hint}</span>}
      </span>
      <span aria-hidden="true" className={['shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors', checked ? 'bg-brand' : 'bg-line-strong'].join(' ')}>
        <span className={['block w-5 h-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : ''].join(' ')} />
      </span>
    </button>
  )
}

function Dot({ label, hex, on, onClick }) {
  return (
    <button
      type="button" role="radio" aria-checked={on} aria-label={label} title={label} onClick={onClick}
      className={[
        'w-8 h-8 rounded-full grid place-items-center shrink-0 transition-shadow',
        on ? 'ring-2 ring-offset-2 ring-ink ring-offset-bg-raised' : 'hover:ring-2 hover:ring-line-strong hover:ring-offset-2 hover:ring-offset-bg-raised',
      ].join(' ')}
      style={{ background: hex }}
    >
      {on && <span className="text-white text-sm font-bold drop-shadow" aria-hidden="true">✓</span>}
    </button>
  )
}

// A tiny picture of the app in the colours that would result: sidebar, reading
// surface, a line of text and a button in the accent colour.
function thumbColours(mode, prefs) {
  const s = surfacesFor(prefs.background, mode)
  const brand = prefs.accent
    ? hexOf(accentVars(prefs.accent, mode, prefs.background)['--brand'])
    : (mode === 'dark' ? '#5865f2' : '#4752c4')
  return { side: rgbToHex(s.bgDark), main: rgbToHex(s.bgMain), card: rgbToHex(s.bgRaised), line: rgbToHex(s.lineStrong), brand }
}
const hexOf = (channels) => rgbToHex(channels.split(' ').map(Number))

function ThumbHalf({ c }) {
  return (
    <span className="flex h-full w-full" style={{ background: c.main }}>
      <span className="w-1/4 h-full" style={{ background: c.side }} />
      <span className="flex-1 p-1.5 flex flex-col gap-1">
        <span className="h-1.5 w-3/4 rounded-sm" style={{ background: c.line }} />
        <span className="h-1.5 w-1/2 rounded-sm" style={{ background: c.line }} />
        <span className="h-2 w-2/5 rounded-sm mt-auto" style={{ background: c.brand }} />
      </span>
    </span>
  )
}

function ThemeThumb({ mode, prefs }) {
  const dark = thumbColours('dark', prefs)
  const light = thumbColours('light', prefs)
  return (
    <span className="relative flex h-14 rounded-md overflow-hidden border border-black/20" aria-hidden="true">
      {mode === 'auto' ? (
        <>
          <span className="w-1/2 h-full overflow-hidden"><ThumbHalf c={light} /></span>
          <span className="w-1/2 h-full overflow-hidden relative"><span className="absolute inset-y-0 right-0 w-[200%]"><ThumbHalf c={dark} /></span></span>
        </>
      ) : <ThumbHalf c={mode === 'light' ? light : dark} />}
    </span>
  )
}

// A small conversation, drawn with the real classes so it shows the person's choices
// (colours, text size, spacing, clock) exactly as the app will.
function Preview({ prefs }) {
  const now = new Date()
  const earlier = new Date(now.getTime() - 3 * 60 * 1000)
  return (
    <div className="mt-4 rounded-lg border border-line-subtle bg-bg-main px-4 py-3" aria-label="Preview of your choices">
      <div className="msg-flow space-y-4">
        <div data-msg-id="preview-1" className="flex gap-3 py-0.5">
          <div className="w-9 h-9 rounded-full bg-brand text-white grid place-items-center text-sm font-semibold shrink-0" aria-hidden="true">A</div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">Ana</span>
              <span className="text-xs text-ink-dim">{headerTime(earlier, prefs.timeFormat)}</span>
            </div>
            <div className="text-ink">Lunch at 12? I booked the corner table.</div>
          </div>
        </div>
        <div data-msg-id="preview-2" className="flex gap-3 py-0.5">
          <div className="w-9 h-9 rounded-full bg-bg-hover text-ink grid place-items-center text-sm font-semibold shrink-0" aria-hidden="true">You</div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">You</span>
              <span className="text-xs text-ink-dim">{headerTime(now, prefs.timeFormat)}</span>
            </div>
            <div className="text-ink">Perfect, see you there. <span className="text-brand-text bg-brand-soft rounded px-1">@Ana</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
