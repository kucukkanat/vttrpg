/**
 * Model import dialog (reports/Level design plan.md, Phase 3): Upload, Poly Haven and Sketchfab
 * tabs feeding one pipeline, then a real-size confirm step with a 3D preview. Self-contained: the
 * library drawer mounts it with `open`, `onClose`, `onImported` and the assets service.
 *
 * The pipeline (glTF Transform, meshoptimizer, three.js loaders) and the 3D preview load on first
 * use, so mounting the dialog costs only this file and the two small API clients.
 */
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { AssetResolver } from '@/assets'
import { LICENCE_LABELS, needsCredit, type CatalogueEntry, type LicenceId } from '@/core/catalogue'
import { Icon } from '@/ui/icons'
import { ACCEPT, extOf, titleFromName } from '@/import/model/formats'
import { CATEGORIES } from '@/import/model/normalise'
import {
  filterPolyHaven, importFromPolyHaven, listPolyHavenModels, POLYHAVEN_CREDIT, type PolyHavenModel,
} from '@/import/model/polyhaven'
import {
  downloadArchive, forgetSketchfabToken, getSketchfabToken, importFromSketchfab, needsSizeWarning, searchSketchfab, setSketchfabToken,
  SKETCHFAB_CREDIT, SKETCHFAB_TOKEN_HELP, type SketchfabCursor, type SketchfabLicenceFilter, type SketchfabModel,
} from '@/import/model/sketchfab'
import { isModelImportError, MAX_IMPORT_BYTES, type ImportProgress, type ImportTier, type PreparedModel } from '@/import/model/types'
import './ImportDialog.css'

const ModelPreview = lazy(() => import('./ModelPreview'))
const loadPipeline = () => import('@/import/model/pipeline')

export type ImportTab = 'upload' | 'polyhaven' | 'sketchfab'

export interface ImportDialogProps {
  open: boolean
  onClose: () => void
  onImported: (entry: CatalogueEntry) => void
  /** The assets service; only `shareFile` is used (it stores, encrypts and uploads the bytes for every player). */
  assets: Pick<AssetResolver, 'shareFile'>
  tier?: ImportTier
  initialTab?: ImportTab
}

const TABS: Array<{ id: ImportTab; label: string }> = [
  { id: 'upload', label: 'Upload' },
  { id: 'polyhaven', label: 'Poly Haven' },
  { id: 'sketchfab', label: 'Sketchfab' },
]

export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '?'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function formatCount(n: number | undefined): string {
  if (!n) return '?'
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

const formatMetres = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2))

function errorText(e: unknown): string {
  if (isModelImportError(e)) return e.message
  return 'Something went wrong while importing. Try another file or a smaller download.'
}

interface Job { label: string; progress: ImportProgress; abort: AbortController }

export function ImportDialog({ open, onClose, onImported, assets, tier, initialTab = 'upload' }: ImportDialogProps) {
  const titleId = useId()
  const [tab, setTab] = useState<ImportTab>(initialTab)
  const [job, setJob] = useState<Job | null>(null)
  const [prepared, setPrepared] = useState<PreparedModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const jobRef = useRef<Job | null>(null)
  jobRef.current = job

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      if (jobRef.current) jobRef.current.abort.abort()
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      returnTo.current?.focus?.()
    }
  }, [open, onClose])

  useEffect(() => () => jobRef.current?.abort.abort(), [])

  /** Runs one prepare job with progress and cancellation; errors land in the banner. */
  const run = useCallback(async (label: string, work: (signal: AbortSignal, onProgress: (p: ImportProgress) => void) => Promise<PreparedModel>) => {
    const abort = new AbortController()
    const start: Job = { label, abort, progress: { stage: 'read', progress: 0, message: 'Starting' } }
    setError(null)
    setJob(start)
    try {
      const result = await work(abort.signal, (p) => setJob((j) => (j && j.abort === abort ? { ...j, progress: p } : j)))
      if (!abort.signal.aborted) setPrepared(result)
    } catch (e) {
      if (!(isModelImportError(e) && e.code === 'cancelled') && !abort.signal.aborted) setError(errorText(e))
    } finally {
      setJob((j) => (j?.abort === abort ? null : j))
    }
  }, [])

  const confirm = useCallback(async (scale: number) => {
    if (!prepared) return
    const abort = new AbortController()
    setError(null)
    setJob({ label: prepared.entry.title, abort, progress: { stage: 'store', progress: 0.96, message: 'Saving the model' } })
    try {
      const { storeModel } = await loadPipeline()
      const entry = await storeModel(prepared, assets, { scale, onProgress: (p) => setJob((j) => (j ? { ...j, progress: p } : j)) })
      setPrepared(null)
      onImported(entry)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setJob(null)
    }
  }, [prepared, assets, onImported])

  if (!open) return null

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setTab(next.id)
    document.getElementById(`${titleId}-tab-${next.id}`)?.focus()
  }

  let body: ReactNode
  if (job) body = <ProgressView job={job} />
  else if (prepared) body = <ConfirmStep prepared={prepared} onBack={() => setPrepared(null)} onConfirm={confirm} />
  else {
    body = (
      <>
        <div className="import-tabs" role="tablist" aria-label="Import from" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${titleId}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${titleId}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'is-on' : undefined}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </div>
        <div className="import-panel" role="tabpanel" id={`${titleId}-panel`} aria-labelledby={`${titleId}-tab-${tab}`}>
          {tab === 'upload' && <UploadTab tier={tier} run={run} />}
          {tab === 'polyhaven' && <PolyHavenTab tier={tier} run={run} />}
          {tab === 'sketchfab' && <SketchfabTab tier={tier} run={run} />}
        </div>
      </>
    )
  }

  return (
    <div className="import-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !job) onClose() }}>
      <div className="import-dialog skin-paper" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog} tabIndex={-1}>
        <div className="import-head">
          <h2 id={titleId}>Import a model</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose} disabled={!!job}><Icon name="close" /></button>
        </div>
        {error && <p className="import-error" role="alert"><Icon name="warning" size={16} /> {error}</p>}
        {body}
      </div>
    </div>
  )
}

type Run = (label: string, work: (signal: AbortSignal, onProgress: (p: ImportProgress) => void) => Promise<PreparedModel>) => Promise<void>

function ProgressView({ job }: { job: Job }) {
  const pct = Math.round(job.progress.progress * 100)
  return (
    <div className="import-progress">
      <p className="import-progress-title">{job.label}</p>
      <progress max={100} value={pct} aria-label={`Importing ${job.label}`} />
      <p className="muted small" aria-live="polite">{job.progress.message} · {pct}%</p>
      {job.progress.stage !== 'store' && <button type="button" onClick={() => job.abort.abort()}>Cancel</button>}
    </div>
  )
}

function LicenceBadge({ id }: { id: LicenceId }) {
  return <span className={`import-badge import-badge-${id}`} title={LICENCE_LABELS[id]}>{id === 'own-work' ? 'Own' : id === 'cc0' ? 'CC0' : id === 'cc-by' ? 'CC BY' : 'CC BY-SA'}</span>
}

// ---------------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------------

const LICENCE_CHOICES: Array<{ id: LicenceId | 'other'; label: string }> = [
  { id: 'own-work', label: 'My own work' },
  { id: 'cc0', label: LICENCE_LABELS.cc0 },
  { id: 'cc-by', label: LICENCE_LABELS['cc-by'] },
  { id: 'cc-by-sa', label: LICENCE_LABELS['cc-by-sa'] },
  { id: 'other', label: 'Something else / not sure' },
]

function UploadTab({ tier, run }: { tier?: ImportTier; run: Run }) {
  const ids = useId()
  const [files, setFiles] = useState<File[]>([])
  const [drag, setDrag] = useState(false)
  const [licence, setLicence] = useState<LicenceId | 'other'>('own-work')
  const [author, setAuthor] = useState('')
  const [source, setSource] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [zUp, setZUp] = useState<boolean | null>(null)
  const total = files.reduce((n, f) => n + f.size, 0)
  const isStl = files.some((f) => extOf(f.name) === 'stl')
  const tooBig = total > MAX_IMPORT_BYTES
  const needsAuthor = licence !== 'other' && needsCredit({ id: licence })
  const ready = files.length > 0 && !tooBig && licence !== 'other' && (!needsAuthor || author.trim().length > 0)

  const add = (list: FileList | null) => {
    if (!list?.length) return
    const next = [...files, ...Array.from(list)].filter((f, i, a) => a.findIndex((g) => g.name === f.name && g.size === f.size) === i)
    setFiles(next)
    if (!title) {
      const main = next.find((f) => /\.(glb|gltf|obj|fbx|stl)$/i.test(f.name)) ?? next[0]
      setTitle(titleFromName(main.name))
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    add(e.dataTransfer.files)
  }

  const start = () => run(title || 'Model', async (signal, onProgress) => {
    const { prepareModel, readFiles } = await loadPipeline()
    onProgress({ stage: 'read', progress: 0.01, message: 'Reading files' })
    const input = await readFiles(files)
    return prepareModel(input, {
      origin: 'upload',
      title,
      category: category || undefined,
      licence: { id: licence as LicenceId, author, source: source || undefined, sourceUrl: sourceUrl || undefined },
    }, { tier, signal, onProgress, zUp: zUp ?? undefined })
  })

  return (
    <div className="import-upload">
      <label
        className={`import-drop${drag ? ' is-drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <input type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <Icon name="plus" size={24} />
        <span><strong>Choose files</strong> or drop them here</span>
        <span className="muted small">GLB, glTF (with its .bin and textures), OBJ + MTL, FBX, STL, or a zip. Up to 100 MB.</span>
      </label>
      {files.length > 0 && (
        <div className="import-files">
          <ul aria-label="Selected files">
            {files.map((f) => <li key={f.name + f.size}><span>{f.name}</span> <span className="muted small">{formatBytes(f.size)}</span></li>)}
          </ul>
          <div className="row">
            <span className={tooBig ? 'error small' : 'muted small'}>{formatBytes(total)} total{tooBig ? ' — over the 100 MB limit' : ''}</span>
            <span className="spacer" />
            <button type="button" className="tiny" onClick={() => { setFiles([]); setTitle('') }}>Clear</button>
          </div>
        </div>
      )}

      <fieldset className="import-licence">
        <legend>Licence</legend>
        <label>
          Who may use this model?
          <select value={licence} onChange={(e) => setLicence(e.target.value as LicenceId | 'other')}>
            {LICENCE_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {licence === 'other' && (
          <p className="import-warn small" role="note">
            Every imported model is shared with your players through public servers, so only CC0, CC BY, CC BY-SA or your own work can be imported.
            Non-commercial, no-derivatives, “standard” and purchased royalty-free models cannot.
          </p>
        )}
        {licence !== 'other' && licence !== 'own-work' && (
          <>
            <label>
              Author{needsAuthor ? ' (required)' : ''}
              <input value={author} onChange={(e) => setAuthor(e.target.value)} required={needsAuthor} aria-required={needsAuthor} autoComplete="off" />
            </label>
            <div className="import-two">
              <label>Source <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Kenney, itch.io…" /></label>
              <label>Source link <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" /></label>
            </div>
          </>
        )}
      </fieldset>

      <div className="import-two">
        <label>Name <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>
          Shelf
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Guess from the name</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
        </label>
      </div>
      <label className="import-check" htmlFor={`${ids}-zup`}>
        <input id={`${ids}-zup`} type="checkbox" checked={zUp ?? isStl} onChange={(e) => setZUp(e.target.checked)} />
        <span>The model is Z-up (it would lie on its side; typical for STL)</span>
      </label>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="primary" disabled={!ready} onClick={start}>Prepare model</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Result cards
// ---------------------------------------------------------------------------------------------

interface CardProps {
  thumbnail?: string
  title: string
  author: string
  licence: LicenceId
  triangles?: number
  size: string
  sizeWarn?: boolean
  pageUrl: string
  pageLabel: string
  action: ReactNode
}

function ResultCard(p: CardProps) {
  return (
    <li className="import-card">
      <div className="import-thumb">
        {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <Icon name="image" size={32} />}
        <LicenceBadge id={p.licence} />
      </div>
      <div className="import-card-body">
        <a className="import-card-title" href={p.pageUrl} target="_blank" rel="noreferrer noopener" title={`${p.title} on ${p.pageLabel}`}>{p.title}</a>
        <span className="muted small import-card-author">by {p.author}</span>
        <span className="small import-card-stats">
          <span title="Triangles">{formatCount(p.triangles)} tris</span>
          <span className={p.sizeWarn ? 'import-size-warn' : undefined} title="Download size">{p.size}</span>
        </span>
        {p.action}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------------------------
// Poly Haven
// ---------------------------------------------------------------------------------------------

function PolyHavenTab({ tier, run }: { tier?: ImportTier; run: Run }) {
  const [all, setAll] = useState<PolyHavenModel[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [shown, setShown] = useState(48)

  useEffect(() => {
    const abort = new AbortController()
    listPolyHavenModels({ signal: abort.signal }).then(setAll, (e) => { if (!abort.signal.aborted) setLoadError(errorText(e)) })
    return () => abort.abort()
  }, [])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of all ?? []) for (const c of m.categories) counts.set(c, (counts.get(c) ?? 0) + 1)
    return [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [all])
  const results = useMemo(() => (all ? filterPolyHaven(all, query, category || undefined) : []), [all, query, category])

  const importModel = (m: PolyHavenModel) => run(m.title, (signal, onProgress) => importFromPolyHaven(m, { tier, signal, onProgress }))

  return (
    <div className="import-search">
      <div className="import-search-bar">
        <label className="import-grow">
          <span className="sr-only">Search Poly Haven</span>
          <input type="search" value={query} placeholder="Search Poly Haven models" onChange={(e) => { setQuery(e.target.value); setShown(48) }} />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setShown(48) }}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {loadError && <p className="error small" role="alert">{loadError}</p>}
      {!all && !loadError && <p className="muted small" aria-live="polite">Loading Poly Haven…</p>}
      {all && <p className="muted small" aria-live="polite">{results.length} models · all CC0</p>}
      <ul className="import-grid">
        {results.slice(0, shown).map((m) => (
          <ResultCard
            key={m.id}
            thumbnail={m.thumbnail}
            title={m.title}
            author={m.authors.join(', ') || 'Poly Haven'}
            licence="cc0"
            triangles={m.polycount}
            size={m.dimensions ? `${m.dimensions.map((d) => formatMetres(d)).join(' × ')} m` : '—'}
            pageUrl={m.pageUrl}
            pageLabel="Poly Haven"
            action={<button type="button" className="tiny" onClick={() => importModel(m)} aria-label={`Import ${m.title}`}>Import</button>}
          />
        ))}
      </ul>
      {results.length > shown && <button type="button" className="wide" onClick={() => setShown((n) => n + 48)}>Show more</button>}
      <p className="import-credit small"><a href="https://polyhaven.com" target="_blank" rel="noreferrer noopener">{POLYHAVEN_CREDIT}</a></p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Sketchfab
// ---------------------------------------------------------------------------------------------

function TokenField({ token, onChange }: { token: string | null; onChange: (t: string | null) => void }) {
  const id = useId()
  const [draft, setDraft] = useState('')
  if (token) {
    return (
      <div className="import-token row">
        <span className="small"><Icon name="lock" size={16} /> Sketchfab token saved in this browser only.</span>
        <span className="spacer" />
        <button type="button" className="tiny" onClick={() => { forgetSketchfabToken(); onChange(null) }}>Forget token</button>
      </div>
    )
  }
  return (
    <form className="import-token" onSubmit={(e) => { e.preventDefault(); if (setSketchfabToken(draft)) { onChange(getSketchfabToken()); setDraft('') } }}>
      <label htmlFor={id}>Sketchfab API token (needed to download)</label>
      <div className="row">
        <input id={id} type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} className="import-grow" />
        <button type="submit" className="tiny" disabled={!draft.trim()}>Save</button>
      </div>
      <span className="muted small">
        Find it in your Sketchfab settings under <a href={SKETCHFAB_TOKEN_HELP} target="_blank" rel="noreferrer noopener">Password &amp; API</a>.
        It stays in this browser and is never shared with players.
      </span>
    </form>
  )
}

function SketchfabTab({ tier, run }: { tier?: ImportTier; run: Run }) {
  const [token, setToken] = useState<string | null>(() => getSketchfabToken())
  const [query, setQuery] = useState('')
  const [licence, setLicence] = useState<SketchfabLicenceFilter>('all')
  const [maxFaces, setMaxFaces] = useState(20000)
  const [results, setResults] = useState<SketchfabModel[]>([])
  const [cursor, setCursor] = useState<SketchfabCursor | null>(null)
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [confirmUid, setConfirmUid] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const search = async (more = false) => {
    abort.current?.abort()
    const a = new AbortController()
    abort.current = a
    setBusy(true)
    setSearchError(null)
    try {
      const page = await searchSketchfab(query, { licence, maxFaces: maxFaces || undefined, cursor: more ? cursor ?? undefined : undefined, signal: a.signal })
      setResults((r) => (more ? [...r, ...page.results.filter((x) => !r.some((y) => y.uid === x.uid))] : page.results))
      setCursor(page.cursor)
      setSearched(true)
    } catch (e) {
      if (!a.signal.aborted) setSearchError(errorText(e))
    } finally {
      if (abort.current === a) setBusy(false)
    }
  }

  const importModel = (m: SketchfabModel) => {
    if (!token) return
    setConfirmUid(null)
    run(m.title, (signal, onProgress) => importFromSketchfab(m, token, { tier, signal, onProgress }))
  }

  return (
    <div className="import-search">
      <TokenField token={token} onChange={setToken} />
      <form className="import-search-bar" onSubmit={(e) => { e.preventDefault(); search() }}>
        <label className="import-grow">
          <span className="sr-only">Search Sketchfab</span>
          <input type="search" value={query} placeholder="Search Sketchfab models" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          <span className="sr-only">Licence</span>
          <select value={licence} onChange={(e) => setLicence(e.target.value as SketchfabLicenceFilter)}>
            <option value="all">CC0, BY and BY-SA</option>
            <option value="cc0">CC0 only</option>
            <option value="cc-by">CC BY only</option>
            <option value="cc-by-sa">CC BY-SA only</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Triangle limit</span>
          <select value={maxFaces} onChange={(e) => setMaxFaces(Number(e.target.value))}>
            <option value={5000}>Up to 5k tris</option>
            <option value={20000}>Up to 20k tris</option>
            <option value={100000}>Up to 100k tris</option>
            <option value={0}>Any size</option>
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy}><Icon name="search" size={16} /> Search</button>
      </form>
      {searchError && <p className="error small" role="alert">{searchError}</p>}
      {searched && !busy && <p className="muted small" aria-live="polite">{results.length ? `${results.length} downloadable models` : 'No downloadable models under an importable licence.'}</p>}
      <ul className="import-grid">
        {results.map((m) => {
          const arch = downloadArchive(m)
          const warn = needsSizeWarning(m)
          const action = !token
            ? <span className="muted small">Add your token to download</span>
            : confirmUid === m.uid
              ? (
                <span className="import-confirm small" role="group" aria-label="Large download">
                  {formatBytes(arch?.size)} download. Import anyway?
                  <span className="row">
                    <button type="button" className="tiny primary" onClick={() => importModel(m)}>Import</button>
                    <button type="button" className="tiny" onClick={() => setConfirmUid(null)}>Cancel</button>
                  </span>
                </span>
              )
              : <button type="button" className="tiny" disabled={!arch} onClick={() => (warn ? setConfirmUid(m.uid) : importModel(m))} aria-label={`Import ${m.title}`}>Import</button>
          return (
            <ResultCard
              key={m.uid}
              thumbnail={m.thumbnail}
              title={m.title}
              author={m.author}
              licence={m.licence}
              triangles={m.faceCount}
              size={arch ? `${formatBytes(arch.size)} ${arch.kind.toUpperCase()}` : 'No GLB'}
              sizeWarn={warn}
              pageUrl={m.pageUrl}
              pageLabel="Sketchfab"
              action={action}
            />
          )
        })}
      </ul>
      {cursor && results.length > 0 && <button type="button" className="wide" disabled={busy} onClick={() => search(true)}>Load more</button>}
      <p className="import-credit small"><a href="https://sketchfab.com" target="_blank" rel="noreferrer noopener">{SKETCHFAB_CREDIT}</a>. Authors and licences are kept for the scene credits.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Real-size confirm
// ---------------------------------------------------------------------------------------------

function ConfirmStep({ prepared, onBack, onConfirm }: { prepared: PreparedModel; onBack: () => void; onConfirm: (scale: number) => void }) {
  const id = useId()
  const [scale, setScale] = useState(1)
  const [heightText, setHeightText] = useState('')
  const base = prepared.entry.size
  const size = base.map((v) => v * scale)
  const { stats, sizeGuess, entry } = prepared
  const setHeight = (text: string) => {
    setHeightText(text)
    const h = parseFloat(text.replace(',', '.'))
    if (h > 0 && base[1] > 0) setScale(h / base[1])
  }
  const mult = (k: number) => { setScale((s) => s * k); setHeightText('') }

  return (
    <div className="import-confirm-step">
      <Suspense fallback={<div className="import-preview muted small">Loading preview…</div>}>
        <ModelPreview glb={prepared.glb} scale={scale} label={`${entry.title}, ${formatMetres(size[1])} m tall, next to a 1.8 m figure on a 1.5 m square`} />
      </Suspense>
      <div className="import-confirm-side">
        <h3>{entry.title}</h3>
        <p className="small"><LicenceBadge id={entry.licence.id} /> {entry.licence.author ? `by ${entry.licence.author}` : LICENCE_LABELS[entry.licence.id]}{entry.licence.source ? ` · ${entry.licence.source}` : ''}</p>
        <p className="muted small">{sizeGuess.note}</p>
        <dl className="import-dims">
          <div><dt>Width</dt><dd>{formatMetres(size[0])} m</dd></div>
          <div><dt>Height</dt><dd>{formatMetres(size[1])} m</dd></div>
          <div><dt>Depth</dt><dd>{formatMetres(size[2])} m</dd></div>
        </dl>
        <label htmlFor={`${id}-h`}>Real height in metres</label>
        <div className="row import-scale">
          <input id={`${id}-h`} inputMode="decimal" value={heightText} placeholder={formatMetres(size[1])} onChange={(e) => setHeight(e.target.value)} />
          <button type="button" className="tiny" onClick={() => mult(0.5)} aria-label="Half size">×½</button>
          <button type="button" className="tiny" onClick={() => mult(2)} aria-label="Double size">×2</button>
          <button type="button" className="tiny" onClick={() => mult(10)} aria-label="Ten times bigger">×10</button>
          <button type="button" className="tiny" onClick={() => mult(0.1)} aria-label="Ten times smaller">×⅒</button>
          <button type="button" className="tiny" onClick={() => { setScale(1); setHeightText('') }} disabled={scale === 1}>Reset</button>
        </div>
        <p className="muted small">One grid square is 1.5 m (5 ft). A door is about 2 m, a table 0.75 m.</p>
        <p className="small">
          {stats.triangles.toLocaleString()} triangles{stats.simplified ? ` (from ${stats.sourceTriangles.toLocaleString()})` : ''} · {formatBytes(stats.bytes)}
          {stats.sourceBytes ? ` (from ${formatBytes(stats.sourceBytes)})` : ''}
        </p>
        {stats.warnings.length > 0 && (
          <ul className="import-warn small">{stats.warnings.slice(0, 4).map((w) => <li key={w}>{w}</li>)}</ul>
        )}
        <div className="row">
          <button type="button" onClick={onBack}>Back</button>
          <span className="spacer" />
          <button type="button" className="primary" onClick={() => onConfirm(scale)}>Add to library</button>
        </div>
      </div>
    </div>
  )
}

export default ImportDialog
