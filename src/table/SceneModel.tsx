/**
 * Renders a loaded scene: its meshes, and its lights with shadows (capped) and flicker.
 * Applies the scene's in-game transform (`scene.transform`) to the root and per-node overrides
 * (`scene.overrides`) on top of the transforms authored in the GLB. In edit mode a tap on a
 * mesh selects its nearest named node for the gizmo and the Edit panel.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { DirectionalLight, Light, Material, Mesh, Object3D, PointLight, SpotLight, Vector3 } from 'three'
import type { NodeOverride } from '@/core/doc'
import { useGame } from '@/state/store'
import { useTable } from './context'
import {
  applyNodeTransform, effectiveNodeTransform, IDENTITY_TRANSFORM, isVisibleInTree, nearestNamedNode, readBase, type NodeBase,
} from './editing'
import type { LoadedScene } from './sceneLoader'
import { useTableUi, type EditPreview } from './tableState'
import { doubleTapEdit, tapTwice } from './editTap'

export const MAX_SHADOW_CASTERS = 4
const SHADOW_MAP = 1024

/** Smooth pseudo-random flame flicker in roughly [-1, 1]. */
export function flickerNoise(t: number, seed: number): number {
  const s = seed * 1.7
  return 0.5 * Math.sin(t * 7.3 + s) + 0.3 * Math.sin(t * 13.1 + s * 2.3) + 0.2 * Math.sin(t * 23.7 + s * 3.1)
}

/** Remember every node's authored transform once, so overrides can be undone. */
export function captureBases(root: Object3D): void {
  root.traverse((o) => { if (!o.userData.base) o.userData.base = readBase(o) })
}

export function baseOf(o: Object3D): NodeBase | null {
  return (o.userData.base as NodeBase | undefined) ?? null
}

/**
 * Put every node back to its base, then apply overrides (and the live gizmo preview, if it is for
 * a node). Idempotent, so it can run on every change.
 */
export function applyOverrides(root: Object3D, overrides: Record<string, NodeOverride> | undefined, preview: EditPreview | null): void {
  root.traverse((o) => {
    const base = baseOf(o)
    if (!base) return
    const ov = overrides?.[o.name]
    const pv = preview && preview.target.kind === 'node' && preview.target.id === o.name ? preview : null
    if (!ov && !pv) {
      if (o.userData.overridden) { applyNodeTransform(o, base, effectiveNodeTransform(base, undefined)); o.userData.overridden = false }
      return
    }
    const t = effectiveNodeTransform(base, ov)
    if (pv) { t.position = pv.position; t.rotationY = pv.rotationY; t.scale = pv.scale }
    applyNodeTransform(o, base, t)
    o.userData.overridden = true
  })
}

function isUnder(o: Object3D | null, root: Object3D): boolean {
  while (o) { if (o === root) return true; o = o.parent }
  return false
}

export function SceneModel({ loaded }: { loaded: LoadedScene }) {
  const { scene, viewer } = useTable()
  const selection = useGame((s) => s.selection)
  const setSelection = useGame((s) => s.setSelection)
  const editMode = useTableUi((s) => s.editMode)
  const preview = useTableUi((s) => s.editPreview)
  const uiSet = useTableUi((s) => s.set)
  const gm = !viewer || viewer.isGm

  useEffect(() => {
    let casters = 0
    for (const { object } of loaded.lights) {
      if (object instanceof PointLight || object instanceof SpotLight || object instanceof DirectionalLight) {
        const cast = casters < MAX_SHADOW_CASTERS
        object.castShadow = cast
        if (cast) {
          casters++
          object.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
          object.shadow.bias = -0.0008
          object.shadow.normalBias = 0.02
          object.shadow.camera.near = 0.1
          if (!(object instanceof DirectionalLight)) object.shadow.camera.far = 60
        }
      }
    }
  }, [loaded])

  const bases = useMemo(() => loaded.lights.map((l) => (l.object as Light).intensity), [loaded])

  // Walls (meshes named WALL_* or wall_*) fade out when the camera looks down from above so a
  // room does not read as a picture frame in orbit view. Materials are cloned per wall mesh.
  const walls = useMemo(() => {
    const out: { mesh: Mesh; mats: Material[] }[] = []
    loaded.root.traverse((o) => {
      if (!(o instanceof Mesh) || !/^wall[_.]/i.test(o.name)) return
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        const c = (m as Material).clone()
        c.transparent = true
        return c
      })
      o.material = mats.length === 1 ? mats[0]! : mats
      o.castShadow = true
      out.push({ mesh: o, mats })
    })
    return out
  }, [loaded])
  useEffect(() => () => { for (const w of walls) for (const m of w.mats) m.dispose() }, [walls])

  const dir = useMemo(() => new Vector3(), [])
  useFrame(({ camera }) => {
    if (walls.length === 0) return
    camera.getWorldDirection(dir)
    // pitch: 0 = horizontal, 1 = straight down
    const down = Math.max(0, -dir.y)
    const t = Math.min(1, Math.max(0, (down - 0.35) / 0.35))
    const opacity = 1 - 0.85 * t
    for (const w of walls) {
      for (const m of w.mats) {
        if (m.opacity !== opacity) { m.opacity = opacity; m.depthWrite = opacity > 0.95 }
      }
    }
  })

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    for (let i = 0; i < loaded.lights.length; i++) {
      const { object, flicker } = loaded.lights[i]!
      if (!flicker) continue
      ;(object as Light).intensity = bases[i]! * (1 + 0.35 * flicker * flickerNoise(t, i))
    }
  })

  // --- in-game edits -------------------------------------------------------------------------
  useMemo(() => captureBases(loaded.root), [loaded])
  const overrides = scene.overrides
  const nodePreview = preview && preview.target.kind === 'node' ? preview : null
  useEffect(() => { applyOverrides(loaded.root, overrides, nodePreview) }, [loaded, overrides, nodePreview])

  // Base transform of the selected node, for the panel's numbers.
  useEffect(() => {
    if (selection?.kind !== 'node') { uiSet({ nodeBase: null }); return }
    const o = loaded.root.getObjectByName(selection.id)
    const base = o ? baseOf(o) : null
    uiSet({ nodeBase: base ? { name: selection.id, ...base } : null })
  }, [selection, loaded, uiSet])

  const scenePreview = preview && preview.target.kind === 'scene' ? preview : null
  const tr = scene.transform ?? IDENTITY_TRANSFORM
  const offset = scenePreview ? scenePreview.position : tr.offset
  const rotationY = scenePreview ? scenePreview.rotationY : tr.rotationY
  const scale = scenePreview ? scenePreview.scale : tr.scale

  const pick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 3) return // an orbit or a gizmo drag that ended over the model is not a tap
    // The nearest visible hit decides (invisible COL_/FOG_ helpers still raycast); when it belongs
    // to a token or a prop in front of the model, that object owns the tap.
    const hit = e.intersections.find((i) => isVisibleInTree(i.object))
    if (!hit || !isUnder(hit.object, loaded.root)) return
    e.stopPropagation()
    const node = nearestNamedNode(hit.object, loaded.root)
    // Any double tap while editing ends edit mode (the room included).
    if (tapTwice(`node:${node?.name ?? ''}`, e.nativeEvent.clientX, e.nativeEvent.clientY) && doubleTapEdit(null)) return
    if (!node) { setSelection(null); return }
    // A tap picks a part; tapping it again keeps it (the second tap of a double tap ends editing instead).
    setSelection({ kind: 'node', id: node.name })
  }
  const picking = editMode && gm

  return (
    <group position={[offset.x, offset.y, offset.z]} rotation-y={rotationY} scale={scale} onClick={picking ? pick : undefined}>
      <primitive object={loaded.root} />
    </group>
  )
}
