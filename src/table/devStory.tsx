/**
 * Dev story for the table (#/dev/table): the generated dev room with two tokens, hand-built
 * store state, and a tiny control bar to switch camera mode and GM / player view.
 */
import { useEffect, useState } from 'react'
import type { Scene, Token } from '@/core/doc'
import type { AssetHash, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { TableCanvas } from './TableCanvas'
import type { SceneValidationReport } from './sceneLoader'

const SCENE = 'dev-room' as SceneId
const GM = 'gm'.padEnd(64, '0') as PlayerPubkey
const PLAYER = 'p1'.padEnd(64, '0') as PlayerPubkey

const scene: Scene = {
  id: SCENE,
  name: 'Dev room',
  model: {
    sha256: 'dev-room' as AssetHash,
    kind: 'glb',
    mime: 'model/gltf-binary',
    size: 0,
    name: 'dev-room.glb',
    sources: [`${import.meta.env.BASE_URL}library/scenes/dev-room.glb`],
  },
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
]

function seedStore() {
  useGame.getState()._replaceFromDoc({
    meta: { name: 'Dev table', gm: GM, pack: 'mausritter' as never, activeScene: SCENE, createdAt: Date.now() },
    scenes: { [SCENE]: scene } as Record<SceneId, Scene>,
    tokens: Object.fromEntries(tokens.map((t) => [t.id, t])) as Record<TokenId, Token>,
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
    default:
      break
  }
}

export function DevStory() {
  const [ready, setReady] = useState(false)
  const [asGm, setAsGm] = useState(false)
  const [report, setReport] = useState<SceneValidationReport | null>(null)
  const [log, setLog] = useState<string[]>([])
  const cameraMode = useGame((s) => s.scenes[SCENE]?.cameraMode ?? 'orbit')
  const revealed = useGame((s) => s.fog[SCENE]?.revealed.length ?? 0)
  const selected = useGame((s) => s.selectedToken)

  useEffect(() => { seedStore(); setReady(true) }, [])

  const onIntent = (i: Intent) => {
    applyLocally(i)
    setLog((l) => [`${i.type}${i.type === 'token.move' ? ` ${i.token} -> ${i.position.x.toFixed(2)},${i.position.z.toFixed(2)}` : ''}${i.type === 'fog.reveal' ? ` +${i.cells.length}` : ''}`, ...l].slice(0, 6))
  }

  if (!ready) return null
  const bar: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', background: '#17161c', color: '#ddd', fontSize: 13, flexWrap: 'wrap' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0b0b10' }}>
      <div style={bar}>
        <strong>table dev</strong>
        <button onClick={() => applyLocally({ type: 'scene.update', scene: SCENE, patch: { cameraMode: cameraMode === 'orbit' ? 'token' : 'orbit' } })}>
          camera: {cameraMode} (C)
        </button>
        <button onClick={() => setAsGm((v) => !v)}>view: {asGm ? 'GM' : 'player (owns Pip)'}</button>
        <button onClick={() => useGame.getState()._replaceFromDoc({ fog: {} })}>reset fog</button>
        <span>revealed {revealed} · selected {selected ?? '—'}</span>
        <span style={{ opacity: 0.7 }}>G grid · F first person · Esc deselect · drag tokens · right-click / long-press selects</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TableCanvas
          onIntent={onIntent}
          onPresence={() => {}}
          viewer={{ pubkey: asGm ? GM : PLAYER, isGm: asGm }}
          onSceneLoaded={setReport}
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
