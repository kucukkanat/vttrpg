/**
 * Dev story for the build tools (#/dev/table-build): the dev room on a real Y.Doc with the GM's
 * reducer, a bar to pick each build tool, and a switch between the GM, a player and a table
 * display view so doors, fog and party vision can be checked without a game on the relays.
 */
import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import type { Scene, Token } from '@/core/doc'
import type { AssetHash, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { applyIntent } from '@/state/apply'
import { bindDoc, useGame } from '@/state/store'
import { TableCanvas } from '../TableCanvas'
import { useBuildUi, toggleBuildTool, type BuildTool } from './buildState'

const SCENE = 'build-room' as SceneId
const GM = 'gm'.padEnd(64, '0') as PlayerPubkey
const PLAYER = 'p1'.padEnd(64, '0') as PlayerPubkey

const scene: Scene = {
  id: SCENE, name: 'Build room', cameraMode: 'orbit', darkness: 0.6, fogEnabled: true, playersOpenDoors: true,
  model: {
    sha256: 'dev-room' as AssetHash, kind: 'glb', mime: 'model/gltf-binary', size: 0, name: 'dev-room.glb',
    sources: [`${import.meta.env.BASE_URL}library/scenes/dev-room.glb`],
  } as Scene['model'],
  grid: { type: 'square', cellSize: 1.5, origin: { x: -5.25, y: 0, z: -3.75 } },
}
const pip: Token = {
  id: 'tok-pip' as TokenId, scene: SCENE, name: 'Pip', owner: PLAYER, color: '#d98f3e',
  position: { x: -3.75, y: 0, z: 2.25 }, rotationY: 0, scale: 1, vision: 5, light: 2, hidden: false, conditions: [],
}

const TOOLS: BuildTool[] = ['wall', 'door', 'erase', 'fog-reveal', 'fog-hide', 'light', 'prefab-capture']
type View = 'gm' | 'player' | 'display'

export function DevStory() {
  const doc = useMemo(() => new Y.Doc(), [])
  const [view, setView] = useState<View>('gm')
  const tool = useBuildUi((s) => s.tool)
  const prefabs = useGame((s) => s.prefabs)
  const walls = useGame((s) => Object.keys(s.walls).length)
  useEffect(() => {
    const off = bindDoc(doc)
    const env = (intent: Intent) => ({ id: crypto.randomUUID(), from: GM, at: Date.now(), intent })
    doc.getMap('meta').set('gm', GM)
    doc.getMap('meta').set('activeScene', SCENE)
    applyIntent(doc, env({ type: 'scene.add', scene }))
    applyIntent(doc, env({ type: 'token.add', token: pip }))
    return off
  }, [doc])
  const onIntent = (intent: Intent) => applyIntent(doc, { id: crypto.randomUUID(), from: view === 'gm' ? GM : PLAYER, at: Date.now(), intent })
  const viewer = useMemo(() => (
    view === 'gm' ? { pubkey: GM, isGm: true } : view === 'player' ? { pubkey: PLAYER, isGm: false } : { pubkey: 'tv'.padEnd(64, '0') as PlayerPubkey, isGm: false, display: { follow: false } }
  ), [view])
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['gm', 'player', 'display'] as View[]).map((v) => <button key={v} className={v === view ? 'primary' : ''} onClick={() => setView(v)}>{v}</button>)}
        <span style={{ width: 12 }} />
        {TOOLS.map((t) => <button key={t} className={t === tool ? 'primary' : ''} onClick={() => toggleBuildTool(t)}>{t}</button>)}
        {Object.values(prefabs).map((p) => (
          <button key={p.id} onClick={() => useBuildUi.getState().set({ tool: 'prefab-stamp', stamp: { prefab: p.id, turns: 0 } })}>stamp {p.name}</button>
        ))}
        <span className="muted small">{walls} walls</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TableCanvas key={view} onIntent={onIntent} onPresence={() => {}} viewer={viewer} />
      </div>
    </div>
  )
}
