import { useEffect, useRef, useState } from 'react'
import { useVoiceChannel } from '../../lib/useVoiceChannel'
import { listAudioDevices } from '../../lib/webrtc'

/**
 * Discord-style voice settings popover — Input/Output device pickers (each
 * a clickable row that expands into a radio-select list, not a native
 * <select>) plus input/output volume sliders. Anchored above VoiceStatusBar
 * via `absolute bottom-full` on its `relative` parent.
 */
export default function VoiceSettingsPopover({ onClose }) {
  const { voicePrefs, setInputDevice, setOutputDevice, setInputVolume, setOutputVolume } = useVoiceChannel()
  const [devices, setDevices] = useState({ inputs: [], outputs: [] })
  const [expanded, setExpanded] = useState(null) // 'input' | 'output' | null
  const ref = useRef(null)

  useEffect(() => {
    const refresh = () => listAudioDevices().then(setDevices).catch(() => {})
    refresh()
    // The list can change while this is open (plug/unplug a headset).
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  useEffect(() => {
    const onMouseDown = (e) => { if (!ref.current?.contains(e.target)) onClose?.() }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const inputLabel = devices.inputs.find(d => d.deviceId === voicePrefs.inputDeviceId)?.label
    || (voicePrefs.inputDeviceId ? 'Unknown device' : 'System default')
  const outputLabel = devices.outputs.find(d => d.deviceId === voicePrefs.outputDeviceId)?.label
    || (voicePrefs.outputDeviceId ? 'Unknown device' : 'System default')

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-2 right-2 mb-2 bg-bg-raised border border-line-subtle rounded-lg shadow-elev2 p-3 space-y-3 text-sm z-20 max-h-[70vh] overflow-y-auto scrollbar-thin"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-dim">Voice Settings</span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-ink-dim hover:text-ink">
          <CloseIcon />
        </button>
      </div>

      <DeviceSection
        label="Input Device"
        current={inputLabel}
        devices={devices.inputs}
        selectedId={voicePrefs.inputDeviceId}
        expanded={expanded === 'input'}
        onToggle={() => setExpanded(e => e === 'input' ? null : 'input')}
        onSelect={(id) => { setInputDevice(id); setExpanded(null) }}
      />
      <VolumeSlider label="Input Volume" value={voicePrefs.inputVolume} onChange={setInputVolume} />

      <div className="h-px bg-line-subtle" />

      <DeviceSection
        label="Output Device"
        current={outputLabel}
        devices={devices.outputs}
        selectedId={voicePrefs.outputDeviceId}
        expanded={expanded === 'output'}
        onToggle={() => setExpanded(e => e === 'output' ? null : 'output')}
        onSelect={(id) => { setOutputDevice(id); setExpanded(null) }}
      />
      <VolumeSlider label="Output Volume" value={voicePrefs.outputVolume} onChange={setOutputVolume} />
    </div>
  )
}

function DeviceSection({ label, current, devices, selectedId, expanded, onToggle, onSelect }) {
  return (
    <div>
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-2 py-1 text-left">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{label}</div>
          <div className="text-ink truncate">{current}</div>
        </div>
        <ChevronIcon className={expanded ? 'rotate-180 transition-transform shrink-0' : 'transition-transform shrink-0'} />
      </button>
      {expanded && (
        <div className="mt-1 rounded-md bg-bg-deepest overflow-hidden">
          <DeviceOption label="System default" selected={!selectedId} onClick={() => onSelect(null)} />
          {devices.map(d => (
            <DeviceOption
              key={d.deviceId}
              label={d.label || 'Unnamed device'}
              selected={d.deviceId === selectedId}
              onClick={() => onSelect(d.deviceId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DeviceOption({ label, selected, onClick }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-bg-hover transition-colors">
      <span className={[
        'w-3.5 h-3.5 rounded-full border-2 shrink-0 grid place-items-center',
        selected ? 'border-brand' : 'border-ink-dim',
      ].join(' ')}>
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-brand" />}
      </span>
      <span className="truncate text-ink">{label}</span>
    </button>
  )
}

function VolumeSlider({ label, value, onChange }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim mb-1">{label}</div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
    </div>
  )
}

function ChevronIcon({ className = '' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}
