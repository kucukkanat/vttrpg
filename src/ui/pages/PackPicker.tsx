/**
 * New game: pick a built-in system, or load a third-party pack by address or from a bundle file.
 * The pack is checked with the same validation the game uses before Create is allowed, and any
 * problem is shown in one sentence. A bundle file is uploaded to Blossom so players can fetch it.
 */
import { useState } from 'react'
import { BUILTIN_PACKS } from '@/rules'
import { createAssetResolver, DEFAULT_BLOSSOM_SERVERS } from '@/assets'
import { loadIdentity } from '@/net'
import type { AssetRef } from '@/core/assets'
import { PACK_BUNDLE_FORMAT, loadPackFromBundle, loadPackFromUrl, parsePackBundle } from '../packSource'
import { Icon } from '@/ui/icons'

export interface PickedPack {
  id: string
  name: string
  source?: string
  asset?: AssetRef
  /** "Another pack" is picked but nothing valid is loaded yet: Create waits. */
  pending?: boolean
}

const CUSTOM = '__custom'

export function PackPicker({ value, onChange, disabled }: { value: PickedPack; onChange(p: PickedPack): void; disabled?: boolean }) {
  const custom = !!value.pending || !BUILTIN_PACKS.some((p) => p.id === value.id && !value.source && !value.asset)
  const [mode, setMode] = useState<'builtin' | 'custom'>(custom ? 'custom' : 'builtin')
  const [url, setUrl] = useState(value.source ?? '')
  const [state, setState] = useState<{ busy?: string; error?: string; ok?: string }>(custom ? { ok: `${value.name} loaded` } : {})

  const pickBuiltin = (id: string) => {
    if (id === CUSTOM) { setMode('custom'); setState({}); onChange({ id: '', name: '', pending: true }); return }
    setMode('builtin')
    setState({})
    const b = BUILTIN_PACKS.find((p) => p.id === id)!
    onChange({ id: b.id, name: b.name })
  }

  const checkUrl = async () => {
    setState({ busy: 'Checking the pack…' })
    onChange({ id: '', name: '', pending: true })
    try {
      const { url: normalized, pack } = await loadPackFromUrl(url)
      setUrl(normalized)
      setState({ ok: `${pack.manifest.name} ${pack.manifest.version} · ${pack.skills.length} skills` })
      onChange({ id: pack.manifest.id, name: pack.manifest.name, source: normalized })
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setState({ busy: 'Checking the pack file…' })
    onChange({ id: '', name: '', pending: true })
    try {
      const pack = await loadPackFromBundle(parsePackBundle(await file.text()))
      setState({ busy: 'Sharing the pack file so players can load it…' })
      const assets = createAssetResolver({ libraryBase: import.meta.env.BASE_URL + 'library/' })
      const identity = await loadIdentity()
      const local = await assets.importFile(new File([await file.arrayBuffer()], file.name, { type: 'application/json' }))
      let shared: AssetRef
      try {
        shared = await assets.uploadToBlossom(local, DEFAULT_BLOSSOM_SERVERS[0], (ev) => identity.sign(ev))
      } catch (e) {
        throw new Error(`The pack is valid, but uploading it for the players failed (${e instanceof Error ? e.message : String(e)}). Try again, or host the pack folder and use its address.`)
      }
      setState({ ok: `${pack.manifest.name} ${pack.manifest.version} · ${pack.skills.length} skills · shared` })
      onChange({ id: pack.manifest.id, name: pack.manifest.name, asset: shared })
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  const busy = disabled || !!state.busy
  return (
    <div className="pack-picker">
      <label>System
        <select value={mode === 'custom' ? CUSTOM : value.id} onChange={(e) => pickBuiltin(e.target.value)} disabled={busy}>
          {BUILTIN_PACKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value={CUSTOM}>Another pack (address or file)…</option>
        </select>
      </label>
      {mode === 'custom' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ margin: 0 }}>Pack address
            <span style={{ display: 'flex', gap: 8 }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.org/packs/my-system/" inputMode="url" autoComplete="off" disabled={busy} style={{ flex: 1, minWidth: 0 }} />
              <button type="button" onClick={() => void checkUrl()} disabled={busy || !url.trim()}>Check</button>
            </span>
          </label>
          <label className="tiny-file" style={{ justifySelf: 'start', minHeight: 44 }}>
            Or load a pack file (.json)
            <input type="file" accept="application/json,.json" hidden disabled={busy} onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <span className="muted small">
            A pack is JSON only: attributes, sheet, skills. Players&apos; browsers fetch it from the address, which must allow cross-origin requests.
            A pack file is <code>{`{ "format": "${PACK_BUNDLE_FORMAT}", "files": { "pack.json": … } }`}</code>.
          </span>
        </div>
      )}
      <div aria-live="polite" className="small">
        {state.busy && <span className="muted">{state.busy}</span>}
        {state.error && <span className="error" role="alert">{state.error}</span>}
        {!state.busy && !state.error && state.ok && <span className="ok"><Icon name="check" size={14} /> {state.ok}</span>}
      </div>
    </div>
  )
}
