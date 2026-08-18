import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  BOT_SCOPES, createBot, deleteBot, listenBots, rotateBotKey, setBotEnabled, setBotScopes,
} from '../lib/bots'
import Avatar from './Avatar'

/**
 * Bot management, mounted inside the admin panel (super-admins only, same as
 * the rest of that page — firestore.rules requires a workspace admin to write
 * the registry).
 *
 * The one genuinely delicate bit of UX here: an API key exists in plaintext
 * for exactly as long as this component holds it in state. Only its hash is
 * ever written, so a key that isn't copied out of the banner below is gone,
 * and the only recovery is rotating to a new one. The banner says so.
 */
export default function BotsAdmin() {
  const { profile } = useAuth()
  const [bots, setBots] = useState([])
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scopes, setScopes] = useState(() => new Set(['messages:write']))
  const [busy, setBusy] = useState(false)
  // { botUid, name, apiKey } — held in memory only, never persisted anywhere.
  const [freshKey, setFreshKey] = useState(null)

  useEffect(() => listenBots(setBots, (e) => setError(e.message)), [])

  const toggleScope = (id) => setScopes(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const { botUid, apiKey } = await createBot({
        name, description, scopes: [...scopes], createdBy: profile.id,
      })
      setFreshKey({ botUid, name: name.trim(), apiKey })
      setName(''); setDescription(''); setScopes(new Set(['messages:write'])); setCreating(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onRotate = async (bot) => {
    if (!confirm(`Rotate ${bot.name}'s API key?\n\nIts current key stops working immediately.`)) return
    setError(null)
    try {
      const apiKey = await rotateBotKey(bot.id)
      setFreshKey({ botUid: bot.id, name: bot.name, apiKey })
    } catch (err) { setError(err.message) }
  }

  const onDelete = async (bot) => {
    if (!confirm(`Delete ${bot.name}?\n\nIt loses all access immediately. Messages it already posted stay put.`)) return
    setError(null)
    try { await deleteBot(bot.id) }
    catch (err) { setError(err.message) }
  }

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Bots</h2>
          <p className="text-xs text-ink-dim mt-0.5">
            Each bot gets its own identity and only the permissions you grant. Add it to a group
            like a person — that's what decides which channels it can see.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(c => !c)}
          className="shrink-0 px-3 py-1.5 rounded-md bg-brand text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {creating ? 'Cancel' : 'New bot'}
        </button>
      </div>

      {error && (
        <div className="mb-3 text-sm text-bad bg-bad/10 border border-bad/20 rounded-md px-3 py-2">{error}</div>
      )}

      {freshKey && <FreshKeyBanner {...freshKey} onDismiss={() => setFreshKey(null)} />}

      {creating && (
        <form onSubmit={submit} className="mb-4 bg-bg-raised border border-line-subtle rounded-lg p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-ink-dim font-semibold">Name</span>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Music Bot"
                className="mt-1 w-full bg-bg-deepest border border-line-subtle rounded-md px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-ink-dim font-semibold">Description</span>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Plays music in voice channels"
                className="mt-1 w-full bg-bg-deepest border border-line-subtle rounded-md px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
          </div>

          <div>
            <span className="text-[11px] uppercase tracking-wider text-ink-dim font-semibold">Permissions</span>
            <div className="mt-1.5 grid sm:grid-cols-2 gap-1.5">
              {BOT_SCOPES.map(s => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => toggleScope(s.id)}
                  className={[
                    'text-left rounded-md border px-2.5 py-2 transition-colors',
                    scopes.has(s.id) ? 'border-brand bg-brand/10' : 'border-line-subtle hover:bg-bg-hover',
                  ].join(' ')}
                >
                  <span className="block text-sm text-ink">{s.label}</span>
                  <span className="block text-[11px] text-ink-dim leading-snug">{s.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="px-4 py-1.5 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create bot'}
          </button>
        </form>
      )}

      <div className="bg-bg-raised border border-line-subtle rounded-lg overflow-hidden">
        {bots.map(bot => (
          <div key={bot.id} className="px-4 py-3 border-b border-line-subtle last:border-b-0">
            <div className="flex items-start gap-3">
              <Avatar name={bot.name} src={bot.photoURL} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{bot.name}</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand text-white shrink-0">BOT</span>
                  {!bot.enabled && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-bad/20 text-bad shrink-0">
                      DISABLED
                    </span>
                  )}
                </div>
                {bot.description && <div className="text-xs text-ink-dim mt-0.5">{bot.description}</div>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {BOT_SCOPES.map(s => {
                    const on = (bot.scopes || []).includes(s.id)
                    return (
                      <button
                        type="button"
                        key={s.id}
                        title={s.hint}
                        onClick={() => {
                          const next = new Set(bot.scopes || [])
                          if (on) next.delete(s.id); else next.add(s.id)
                          setBotScopes(bot.id, [...next]).catch(e => setError(e.message))
                        }}
                        className={[
                          'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                          on ? 'border-brand bg-brand/15 text-ink' : 'border-line-subtle text-ink-dim hover:text-ink',
                        ].join(' ')}
                      >
                        {s.label}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-1.5 text-[10px] text-ink-dim font-mono break-all">uid {bot.id}</div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setBotEnabled(bot.id, !bot.enabled).catch(e => setError(e.message))}
                  className="text-xs text-ink-muted hover:text-ink"
                >
                  {bot.enabled ? 'Disable' : 'Enable'}
                </button>
                <button type="button" onClick={() => onRotate(bot)} className="text-xs text-ink-muted hover:text-ink">
                  Rotate key
                </button>
                <button type="button" onClick={() => onDelete(bot)} className="text-xs text-bad hover:underline">
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {bots.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-ink-muted">
            No bots yet. Create one, then add it to a group to give it channels.
          </div>
        )}
      </div>
    </section>
  )
}

function FreshKeyBanner({ name, apiKey, onDismiss }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
    } catch { /* clipboard blocked — the key is selectable below regardless */ }
  }
  return (
    <div className="mb-4 border border-warn/40 bg-warn/10 rounded-lg p-4">
      <div className="text-sm font-semibold text-ink">{name}'s API key</div>
      <p className="text-xs text-ink-muted mt-1">
        Copy this now — only a hash of it is stored, so it can't be shown again. If you lose it,
        rotate for a new one. Treat it like a password: it's the bot's whole identity.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 min-w-0 text-xs font-mono bg-bg-deepest border border-line-subtle rounded px-2 py-1.5 break-all select-all">
          {apiKey}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 px-2.5 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:opacity-90"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs text-ink-dim hover:text-ink">
          Done
        </button>
      </div>
    </div>
  )
}
