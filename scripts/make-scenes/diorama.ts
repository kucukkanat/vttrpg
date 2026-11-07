/**
 * Test helper: checks a loaded GLB against the baked diorama contract written by `bakeDiorama`
 * (scripts/make-scenes/lib.mjs).
 */
import { expect } from 'vitest'
import { Mesh, type MeshStandardMaterial, type Object3D } from 'three'

export function isEmissive(m: MeshStandardMaterial): boolean {
  return !!m.emissive && m.emissiveIntensity > 0 && m.emissive.r + m.emissive.g + m.emissive.b > 0
}

/**
 * Root carries `style: 'diorama'`; every visible, non-helper, non-emissive mesh has normalized
 * Uint8 RGBA vertex colours, no uv, and the shared white `diorama` material; emissive meshes keep
 * their own material and get no colours.
 */
export function expectDiorama(root: Object3D): { baked: number; emissive: number } {
  expect(root.userData.style).toBe('diorama')
  let baked = 0
  let emissive = 0
  root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible || /^(COL|FOG)_/.test(o.name)) return
    const m = o.material as MeshStandardMaterial
    if (isEmissive(m)) {
      emissive++
      expect(m.name, o.name).not.toBe('diorama')
      expect(o.geometry.getAttribute('color'), o.name).toBeUndefined()
      return
    }
    baked++
    expect(m.name, o.name).toBe('diorama')
    expect(m.vertexColors, o.name).toBe(true)
    expect(m.color.getHex(), o.name).toBe(0xffffff)
    expect(m.metalness, o.name).toBe(0)
    const c = o.geometry.getAttribute('color')
    expect(c, o.name).toBeDefined()
    expect(c.itemSize, o.name).toBe(4)
    expect(c.normalized, o.name).toBe(true)
    expect(c.array, o.name).toBeInstanceOf(Uint8Array)
    expect(o.geometry.getAttribute('uv'), o.name).toBeUndefined()
  })
  expect(baked).toBeGreaterThan(0)
  return { baked, emissive }
}
