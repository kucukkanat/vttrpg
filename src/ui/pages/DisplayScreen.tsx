/**
 * Route `/display`: the table and nothing else, for a TV or second screen. It sees what the party
 * sees (fog, hidden tokens and GM-only state stay hidden), follows the GM's shared view or frames
 * the whole map, and never sends anything. Moving the pointer shows a small bar for a few seconds
 * to switch between the two, toggle the grid and go full screen.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssetRef } from '@/core/assets'
import { useGame } from '@/state/store'
import { parseDisplayLink } from '@/table/view'
import type { GameController } from '../controller'
import { startDisplay } from '../display'
import './DisplayScreen.css'

const TableCanvas = lazy(() => import('@/table/TableCanvas').then((m) => ({ default: m.TableCanvas })))

const BAR_MS = 3000
const noop = () => {}

export function DisplayScreen({ href }: { href: string }) {
  const link = useMemo(() => parseDisplayLink(href), [href])
  const [controller, setController] = useState<GameController | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!link) return
    let live = true
    let started: GameController | null = null
    startDisplay(link).then(
      (c) => { if (live) { started = c; setController(c) } else c.dispose() },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { live = false; started?.dispose() }
  }, [link])

  if (!link) return <div className="display display--msg"><p>This is not a display link. Copy it again from the Build panel.</p></div>
  if (error) return <div className="display display--msg"><p>Could not open the table: {error}</p></div>
  if (!controller) return <div className="display display--msg"><p className="muted">Connecting the table display…</p></div>
  return <DisplayTable controller={controller} initialFollow={link.view === 'follow'} initialGrid={link.grid} />
}

function DisplayTable({ controller, initialFollow, initialGrid }: { controller: GameController; initialFollow: boolean; initialGrid: boolean }) {
  const scene = useGame((s) => s.meta?.activeScene ?? null)
  const [follow, setFollow] = useState(initialFollow)
  const [grid, setGrid] = useState(initialGrid)
  const [bar, setBar] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewer = useMemo(() => ({ pubkey: controller.pubkey, isGm: false, display: { follow } }), [controller.pubkey, follow])
  const resolveAsset = useCallback((ref: AssetRef) => controller.assets.resolve(ref), [controller])

  const poke = useCallback(() => {
    setBar(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setBar(false), BAR_MS)
  }, [])
  useEffect(() => { poke(); return () => { if (timer.current) clearTimeout(timer.current) } }, [poke])

  // Keep a TV awake while the table is up, where the browser allows it.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }
    nav.wakeLock?.request('screen').then((l) => { lock = l }, () => {})
    return () => { void lock?.release().catch(() => {}) }
  }, [])

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }

  return (
    <div className="display" onPointerMove={poke} onPointerDown={poke}>
      {scene ? (
        <Suspense fallback={<div className="display display--msg"><p className="muted">Loading table…</p></div>}>
          <TableCanvas onIntent={noop} onPresence={noop} resolveAsset={resolveAsset} viewer={viewer} showGrid={grid} />
        </Suspense>
      ) : (
        <div className="display display--msg"><p className="muted">Waiting for the GM to open a scene…</p></div>
      )}
      <div className={`display-bar${bar ? ' display-bar--on' : ''}`} role="toolbar" aria-label="Display">
        <button type="button" className={`tiny${follow ? ' on' : ''}`} aria-pressed={follow} onClick={() => setFollow(true)}>Follow GM</button>
        <button type="button" className={`tiny${!follow ? ' on' : ''}`} aria-pressed={!follow} onClick={() => setFollow(false)}>Whole map</button>
        <button type="button" className={`tiny${grid ? ' on' : ''}`} aria-pressed={grid} onClick={() => setGrid(!grid)}>Grid</button>
        <button type="button" className="tiny" onClick={fullscreen}>Full screen</button>
      </div>
    </div>
  )
}

export default DisplayScreen
