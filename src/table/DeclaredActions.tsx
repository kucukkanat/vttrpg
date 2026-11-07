/**
 * GM-declared enemy actions on the board (`initiative.declared`), Into the Breach style: an
 * orange "!" marker over the combatant and a dashed floor line with an arrowhead to each target.
 * They stay until the GM resolves them, the combatant acts, or the encounter ends. Players never
 * see a declaration on, or aimed at, a hidden token. Never takes pointer events.
 */
import { useMemo } from 'react'
import { CanvasTexture, DoubleSide, SpriteMaterial, SRGBColorSpace } from 'three'
import type { DeclaredAction, Token } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTable } from './context'
import { HOSTILE, INK } from '@/ui/theme/palette'

/** A declared enemy intent is a hostile telegraph: the palette's hostile role. */
export const DECLARED_COLOR = HOSTILE
const noRaycast = () => undefined

/** What one viewer sees of the declarations in `scene`: lines to visible targets only. */
export function visibleDeclarations(
  declared: Record<string, DeclaredAction> | undefined,
  tokens: Record<TokenId, Token>,
  scene: string,
  isGm: boolean,
): { source: Token; label: string; targets: Token[] }[] {
  if (!declared) return []
  const out: { source: Token; label: string; targets: Token[] }[] = []
  for (const d of Object.values(declared)) {
    const source = tokens[d.token]
    if (!source || source.scene !== scene || (!isGm && source.hidden)) continue
    const targets = d.targets.map((id) => tokens[id]).filter((t): t is Token => !!t && t.scene === scene && t.id !== source.id && (isGm || !t.hidden))
    out.push({ source, label: d.label, targets })
  }
  return out
}

/** Dashes along a floor segment from `a` to `b`, stopping `gap` short at both ends. */
export function dashes(a: { x: number; z: number }, b: { x: number; z: number }, gap: number, dash: number): { x: number; z: number; len: number; angle: number }[] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const d = Math.hypot(dx, dz)
  const run = d - 2 * gap
  if (run <= 0 || dash <= 0) return []
  const ux = dx / d
  const uz = dz / d
  const angle = Math.atan2(-dz, dx)
  const out: { x: number; z: number; len: number; angle: number }[] = []
  for (let s = 0; s < run; s += dash * 2) {
    const len = Math.min(dash, run - s)
    const mid = gap + s + len / 2
    out.push({ x: a.x + ux * mid, z: a.z + uz * mid, len, angle })
  }
  return out
}

let markMaterial: SpriteMaterial | null = null
function mark(): SpriteMaterial {
  if (markMaterial) return markMaterial
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = DECLARED_COLOR
  ctx.beginPath()
  ctx.moveTo(size / 2, 3)
  ctx.lineTo(size - 3, size - 6)
  ctx.lineTo(3, size - 6)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.font = 'bold 36px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', size / 2, size * 0.6)
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  markMaterial = new SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false })
  return markMaterial
}

export function DeclaredActions() {
  const declared = useGame((s) => (s.initiative?.active ? s.initiative.declared : undefined))
  const tokens = useGame((s) => s.tokens)
  const { grid, floorY, sceneId, viewer } = useTable()
  const isGm = !viewer || viewer.isGm
  const shown = useMemo(() => visibleDeclarations(declared, tokens, sceneId, isGm), [declared, tokens, sceneId, isGm])
  if (!shown.length) return null
  const cell = grid.cellSize
  const y = floorY + 0.03
  return (
    <group raycast={noRaycast}>
      {shown.map(({ source, label, targets }) => {
        const r = 0.45 * cell * (source.scale || 1)
        return (
          <group key={source.id}>
            <sprite
              material={mark()}
              position={[source.position.x, floorY + (source.elevation ?? 0) + 1.05 * cell * (source.scale || 1), source.position.z]}
              scale={[0.32 * cell, 0.32 * cell, 1]}
              renderOrder={9}
              raycast={noRaycast}
              name={`declared:${label}`}
            />
            {targets.map((t) => {
              const tr = 0.45 * cell * (t.scale || 1)
              const segs = dashes(source.position, t.position, Math.max(r, tr), 0.18 * cell)
              const dx = t.position.x - source.position.x
              const dz = t.position.z - source.position.z
              const d = Math.hypot(dx, dz) || 1
              const tip = { x: t.position.x - (dx / d) * tr, z: t.position.z - (dz / d) * tr }
              return (
                <group key={t.id}>
                  {segs.map((s, i) => (
                    <mesh key={i} position={[s.x, y, s.z]} rotation={[-Math.PI / 2, 0, s.angle]} raycast={noRaycast} renderOrder={5}>
                      <planeGeometry args={[s.len, 0.06 * cell]} />
                      <meshBasicMaterial color={DECLARED_COLOR} transparent opacity={0.85} depthWrite={false} side={DoubleSide} />
                    </mesh>
                  ))}
                  {segs.length > 0 && (
                    <mesh position={[tip.x, y, tip.z]} rotation={[-Math.PI / 2, 0, Math.atan2(-dz, dx)]} raycast={noRaycast} renderOrder={5}>
                      <circleGeometry args={[0.14 * cell, 3]} />
                      <meshBasicMaterial color={DECLARED_COLOR} transparent opacity={0.9} depthWrite={false} side={DoubleSide} />
                    </mesh>
                  )}
                </group>
              )
            })}
          </group>
        )
      })}
    </group>
  )
}
