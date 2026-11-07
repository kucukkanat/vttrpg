/**
 * Dev story for the table (#/dev/table): the generated dev room with two tokens and a prop,
 * hand-built store state, and a tiny control bar to switch camera mode, GM / player view and
 * edit mode. The Edit panel needs a controller, so the bar has buttons that fire the same intents.
 */
import { migratedScale } from '@/core/props'
import { useEffect, useState } from 'react'
import type { Prop, Scene, Token } from '@/core/doc'
import type { TargetShape } from '@/core/geometry'
import type { AssetHash, PlayerPubkey, PropId, SceneId, TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { mergeOverride, resetOverride } from './editing'
import { TableCanvas } from './TableCanvas'
import { placementPoint, useTableUi } from './tableState'
import type { SceneValidationReport } from './sceneLoader'

/** Shapes to try the targeting preview with (no rules pack in this story). */
const AIM_SHAPES: Record<string, TargetShape> = {
  fireball: { kind: 'radius', range: 6, radius: 2 },
  missile: { kind: 'single', range: 8 },
  breath: { kind: 'cone', range: 5, angle: 90 },
  bolt: { kind: 'line', range: 8, width: 1 },
}

const SCENE = 'dev-room' as SceneId
const GM = 'gm'.padEnd(64, '0') as PlayerPubkey
const PLAYER = 'p1'.padEnd(64, '0') as PlayerPubkey

const DEV_ROOM_MODEL = {
  sha256: 'dev-room' as AssetHash,
  kind: 'glb' as const,
  mime: 'model/gltf-binary',
  size: 0,
  name: 'dev-room.glb',
  sources: [`${import.meta.env.BASE_URL}library/scenes/dev-room.glb`],
}

/** A model from the generated library (public/library), referenced by its path. */
function libraryModel(path: string) {
  return {
    sha256: path as AssetHash, kind: 'glb' as const, mime: 'model/gltf-binary', size: 0, name: path.split('/').pop()!,
    sources: [`${import.meta.env.BASE_URL}library/${path}`],
  }
}

const scene: Scene = {
  id: SCENE,
  name: 'Dev room',
  model: DEV_ROOM_MODEL,
  grid: { type: 'square', cellSize: 1.5, origin: { x: -5.25, y: 0, z: -3.75 } },
  cameraMode: 'orbit',
  darkness: 0.9,
}

const tokens: Token[] = [
  {
    id: 'tok-mouse' as TokenId, scene: SCENE, name: 'Pip Thistledown', owner: PLAYER, color: '#d98f3e',
    position: { x: -3.75, y: 0, z: 2.25 }, rotationY: 0, scale: 1, vision: 4, light: 2, hidden: false, conditions: [],
  },
  {
    id: 'tok-rat' as TokenId, scene: SCENE, name: 'Sewer Rat', color: '#6c7a8a',
    position: { x: 3.75, y: 0, z: -2.25 }, rotationY: Math.PI, scale: 1.2, vision: 2, light: 0, hidden: false, conditions: [],
  },
  {
    id: 'tok-knight' as TokenId, scene: SCENE, name: 'Sir Brannoc', color: '#2f4f8c', model: libraryModel('minis/knight.glb'),
    position: { x: -0.75, y: 0, z: 0.75 }, rotationY: 0.4, scale: 1, vision: 4, light: 0, hidden: false, conditions: [],
  },
  {
    id: 'tok-wizard' as TokenId, scene: SCENE, name: 'Old Mag', color: '#5a3f6b', model: libraryModel('minis/wizard.glb'),
    position: { x: -3.75, y: 0, z: -2.25 }, rotationY: -0.5, scale: 1, vision: 4, light: 0, hidden: false, conditions: [],
  },
]

/** The dev room again, shrunk to a doll's house, plus a few library props (one of them lit). */
const props: Prop[] = [
  {
    id: 'prop-dollhouse' as PropId, scene: SCENE, name: 'Doll house', model: DEV_ROOM_MODEL,
    position: { x: 2.25, y: 0, z: 2.25 }, rotation: { x: 0, y: Math.PI / 6, z: 0 }, scale: 0.15, solid: true,
  },
  {
    id: 'prop-cauldron' as PropId, scene: SCENE, name: 'Cauldron', model: libraryModel('props/cauldron.glb'),
    position: { x: 0.75, y: 0, z: 2.25 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1, solid: true,
  },
  {
    id: 'prop-rack' as PropId, scene: SCENE, name: 'Weapon rack', model: libraryModel('props/weapon-rack.glb'),
    position: { x: 5.25, y: 0, z: 0.75 }, rotation: { x: 0, y: -Math.PI / 2, z: 0 }, scale: 1, solid: true,
  },
]

function seedStore() {
  useGame.getState()._replaceFromDoc({
    meta: { name: 'Dev table', gm: GM, pack: 'mausritter' as never, activeScene: SCENE, createdAt: Date.now() },
    scenes: { [SCENE]: scene } as Record<SceneId, Scene>,
    tokens: Object.fromEntries(tokens.map((t) => [t.id, t])) as Record<TokenId, Token>,
    props: Object.fromEntries(props.map((p) => [p.id, p])) as Record<PropId, Prop>,
    characters: {},
    chat: [],
    fog: {},
  })
}

/** Applies intents straight to the store, standing in for the GM's reducer. */
function applyLocally(intent: Intent) {
  const s = useGame.getState()
  switch (intent.type) {
    case 'token.move': {
      const t = s.tokens[intent.token]
      if (t) s._replaceFromDoc({ tokens: { ...s.tokens, [intent.token]: { ...t, position: intent.position, rotationY: intent.rotationY ?? t.rotationY } } })
      break
    }
    case 'token.update': {
      const t = s.tokens[intent.token]
      if (t) s._replaceFromDoc({ tokens: { ...s.tokens, [intent.token]: { ...t, ...intent.patch, id: t.id } } })
      break
    }
    case 'fog.reveal': {
      const prev = s.fog[intent.scene]?.revealed ?? []
      const merged = Array.from(new Set([...prev, ...intent.cells]))
      s._replaceFromDoc({ fog: { ...s.fog, [intent.scene]: { scene: intent.scene, revealed: merged } } })
      break
    }
    case 'scene.update': {
      const sc = s.scenes[intent.scene]
      if (sc) s._replaceFromDoc({ scenes: { ...s.scenes, [intent.scene]: { ...sc, ...intent.patch, id: sc.id } } })
      break
    }
    case 'prop.add':
      s._replaceFromDoc({ props: { ...s.props, [intent.prop.id]: intent.prop } })
      break
    case 'prop.update': {
      const p = s.props[intent.prop]
      if (p) s._replaceFromDoc({ props: { ...s.props, [intent.prop]: { ...p, ...intent.patch, id: p.id } } })
      break
    }
    case 'prop.remove': {
      const next = { ...s.props }
      delete next[intent.prop]
      s._replaceFromDoc({ props: next })
      break
    }
    case 'props.place': {
      const next = { ...s.props }
      for (const p of intent.props) next[p.id] = p
      s._replaceFromDoc({ props: next })
      break
    }
    case 'props.update': {
      const next = { ...s.props }
      for (const u of intent.updates) { const p = next[u.id]; if (p) next[u.id] = { ...p, ...u.patch, id: p.id } }
      s._replaceFromDoc({ props: next })
      break
    }
    case 'props.remove': {
      const next = { ...s.props }
      for (const id of intent.ids) delete next[id]
      s._replaceFromDoc({ props: next })
      break
    }
    case 'props.migrate': {
      const next = { ...s.props }
      for (const { id, fit } of intent.items) { const p = next[id]; if (p && typeof p.scale === 'number') next[id] = { ...p, scale: migratedScale(p.scale, fit), legacyFit: fit } }
      s._replaceFromDoc({ props: next })
      break
    }
    default:
      break
  }
}

function describe(i: Intent): string {
  switch (i.type) {
    case 'token.move': return `${i.type} ${i.token} -> ${i.position.x.toFixed(2)},${i.position.z.toFixed(2)}`
    case 'token.update': return `${i.type} ${JSON.stringify(i.patch)}`
    case 'prop.update': return `${i.type} ${JSON.stringify(i.patch)}`
    case 'props.update': return `${i.type} ${JSON.stringify(i.updates)}`
    case 'scene.update': return `${i.type} ${JSON.stringify(i.patch)}`
    case 'fog.reveal': return `${i.type} +${i.cells.length}`
    default: return i.type
  }
}

export function DevStory() {
  const [ready, setReady] = useState(false)
  const [asGm, setAsGm] = useState(true)
  const [report, setReport] = useState<SceneValidationReport | null>(null)
  const [log, setLog] = useState<string[]>([])
  const cameraMode = useGame((s) => s.scenes[SCENE]?.cameraMode ?? 'orbit')
  const gridType = useGame((s) => s.scenes[SCENE]?.grid.type ?? 'square')
  const revealed = useGame((s) => s.fog[SCENE]?.revealed.length ?? 0)
  const selection = useGame((s) => s.selection)
  const setSelection = useGame((s) => s.setSelection)
  const sceneDoc = useGame((s) => s.scenes[SCENE])
  const propCount = useGame((s) => Object.keys(s.props).length)
  const editMode = useTableUi((s) => s.editMode)
  const gizmoMode = useTableUi((s) => s.gizmoMode)
  const snap = useTableUi((s) => s.snap)
  const uiSet = useTableUi((s) => s.set)
  const [aim, setAim] = useState<string | null>(null)

  useEffect(() => { seedStore(); setReady(true) }, [])

  const onIntent = (i: Intent) => {
    applyLocally(i)
    setLog((l) => [describe(i), ...l].slice(0, 6))
  }

  const addProp = () => {
    const id = `prop-${Date.now().toString(36)}` as PropId
    const at = placementPoint()
    // A version 1 scale on purpose: the story exercises the legacy fit and its migration.
    onIntent({ type: 'props.place', props: [{ id, scene: SCENE, name: 'Crate house', model: DEV_ROOM_MODEL, position: at, rotation: { x: 0, y: 0, z: 0 }, scale: 0.1 }] })
    setSelection({ kind: 'prop', id })
    uiSet({ editMode: true })
  }
  const pillarScale = sceneDoc?.overrides?.pillar?.scale ?? 1

  if (!ready) return null
  const bar: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', background: '#17161c', color: '#ddd', fontSize: 13, flexWrap: 'wrap' }
  const on = (v: boolean): React.CSSProperties | undefined => (v ? { borderColor: '#e0a458', color: '#e0a458' } : undefined)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0b0b10' }}>
      <div style={bar}>
        <strong>table dev</strong>
        <button onClick={() => applyLocally({ type: 'scene.update', scene: SCENE, patch: { cameraMode: cameraMode === 'orbit' ? 'token' : 'orbit' } })}>
          camera: {cameraMode} (C)
        </button>
        <button onClick={() => setAsGm((v) => !v)}>view: {asGm ? 'GM' : 'player (owns Pip)'}</button>
        <button onClick={() => applyLocally({ type: 'scene.update', scene: SCENE, patch: { grid: { ...scene.grid, type: gridType === 'square' ? 'hex' : 'square' } } })}>
          grid: {gridType}
        </button>
        <button onClick={() => useGame.getState()._replaceFromDoc({ fog: {} })}>reset fog</button>
        <span>aim:</span>
        {Object.keys(AIM_SHAPES).map((k) => (
          <button key={k} onClick={() => setAim(aim === k ? null : k)} style={on(aim === k)}>{k}</button>
        ))}
        <span>revealed {revealed} · selected {selection ? `${selection.kind} ${selection.id}` : '—'}</span>
        <span style={{ opacity: 0.7 }}>G grid · F first person · Esc deselect · drag tokens · right-click / long-press selects</span>
      </div>
      <div style={bar}>
        <strong>edit</strong>
        <button onClick={() => uiSet({ editMode: !editMode })} style={on(editMode)} disabled={!asGm}>edit mode: {editMode ? 'on' : 'off'}</button>
        {(['translate', 'rotate', 'scale'] as const).map((m) => (
          <button key={m} onClick={() => uiSet({ gizmoMode: m })} style={on(gizmoMode === m)}>{m} ({m === 'translate' ? 'G' : m[0]!.toUpperCase()})</button>
        ))}
        <button onClick={() => uiSet({ snap: !snap })} style={on(snap)}>snap: {snap ? 'on' : 'off (Alt = free)'}</button>
        <span>|</span>
        <button onClick={addProp}>add prop ({propCount})</button>
        <button
          disabled={selection?.kind !== 'prop'}
          onClick={() => { if (selection?.kind === 'prop') { onIntent({ type: 'props.remove', ids: [selection.id] }); setSelection(null) } }}
        >remove prop (Del)</button>
        <button
          disabled={selection?.kind !== 'prop'}
          onClick={() => { if (selection?.kind === 'prop') onIntent({ type: 'props.update', updates: [{ id: selection.id, patch: { solid: !useGame.getState().props[selection.id]?.solid } }] }) }}
        >toggle solid</button>
        <span>|</span>
        <button onClick={() => { const t = useGame.getState().tokens['tok-mouse' as TokenId]; if (t) onIntent({ type: 'token.update', token: t.id, patch: { elevation: ((t.elevation ?? 0) + 0.5) % 3 } }) }}>
          Pip elevation +0.5
        </button>
        <button onClick={() => { const t = useGame.getState().tokens['tok-rat' as TokenId]; if (t) onIntent({ type: 'token.update', token: t.id, patch: { rotationY: t.rotationY + Math.PI / 4, scale: t.scale >= 2 ? 1 : t.scale + 0.25 } }) }}>
          Rat turn + grow
        </button>
        <span>|</span>
        <button onClick={() => setSelection({ kind: 'node', id: 'pillar' })} style={on(selection?.kind === 'node')}>select pillar</button>
        <button onClick={() => onIntent({ type: 'scene.update', scene: SCENE, patch: { overrides: mergeOverride(sceneDoc?.overrides, 'pillar', { scale: pillarScale >= 2 ? 0.5 : pillarScale + 0.5 }) } })}>
          pillar scale ×{pillarScale}
        </button>
        <button onClick={() => onIntent({ type: 'scene.update', scene: SCENE, patch: { overrides: mergeOverride(sceneDoc?.overrides, 'pillar', { hidden: !sceneDoc?.overrides?.pillar?.hidden }) } })}>
          pillar hidden: {sceneDoc?.overrides?.pillar?.hidden ? 'yes' : 'no'}
        </button>
        <button onClick={() => onIntent({ type: 'scene.update', scene: SCENE, patch: { overrides: resetOverride(sceneDoc?.overrides, 'pillar') } })}>reset pillar</button>
        <span>|</span>
        <button onClick={() => setSelection({ kind: 'scene', id: SCENE })} style={on(selection?.kind === 'scene')}>select scene</button>
        <button onClick={() => onIntent({ type: 'scene.update', scene: SCENE, patch: { transform: { scale: (sceneDoc?.transform?.scale ?? 1) >= 1.5 ? 0.75 : (sceneDoc?.transform?.scale ?? 1) + 0.25, rotationY: sceneDoc?.transform?.rotationY ?? 0, offset: sceneDoc?.transform?.offset ?? { x: 0, y: 0, z: 0 } } } })}>
          scene scale {sceneDoc?.transform?.scale ?? 1}
        </button>
        <button onClick={() => onIntent({ type: 'scene.update', scene: SCENE, patch: { transform: { scale: 1, rotationY: 0, offset: { x: 0, y: 0, z: 0 } } } })}>reset scene</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TableCanvas
          onIntent={onIntent}
          onPresence={() => {}}
          viewer={{ pubkey: asGm ? GM : PLAYER, isGm: asGm }}
          onSceneLoaded={setReport}
          targeting={aim ? {
            name: aim,
            shape: AIM_SHAPES[aim]!,
            source: 'tok-mouse' as TokenId,
            onPick: (r) => { setLog((l) => [`pick ${aim}: [${r.targets.join(', ')}] @ ${r.point ? `${r.point.x.toFixed(1)},${r.point.z.toFixed(1)}` : '-'}`, ...l].slice(0, 6)); setAim(null) },
            onCancel: () => { setLog((l) => [`cancel ${aim}`, ...l].slice(0, 6)); setAim(null) },
          } : undefined}
        />
      </div>
      <div style={{ ...bar, justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{log.join('  |  ') || 'no intents yet'}</span>
        {report && (
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            found {report.found.length} · missing {report.missing.length} · warnings {report.warnings.length}
            {report.missing.length > 0 && ` (${report.missing.join('; ')})`}
          </span>
        )}
      </div>
    </div>
  )
}

export default DevStory
