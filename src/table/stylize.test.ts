import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Sprite, Vector3,
} from 'three'
import {
  addOutlines, BANDED_LAMBERT, buildGlow, convertMaterial, DIORAMA_STYLE, isGlowing, materialModeFor, outlineMaterial, smoothNormals, stylizeObject, toonMaterial,
} from './stylize'

function model(style?: string) {
  const root = new Group()
  if (style) root.userData.style = style
  const wood = new MeshStandardMaterial({ color: '#7a5a36', vertexColors: true })
  const a = new Mesh(new BoxGeometry(1, 1, 1), wood)
  a.name = 'crate'
  const b = new Mesh(new BoxGeometry(1, 1, 1), wood)
  b.name = 'crate_lid'
  const col = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
  col.name = 'COL_crate'
  root.add(a, b, col)
  return { root, wood, a, b, col }
}

describe('materialModeFor', () => {
  it('toon-shades library models on every tier and keeps PBR for imports when the tier allows', () => {
    expect(materialModeFor(model(DIORAMA_STYLE).root, true)).toBe('toon')
    expect(materialModeFor(model(DIORAMA_STYLE).root, false)).toBe('toon')
    expect(materialModeFor(model().root, true)).toBe('keep')
    expect(materialModeFor(model().root, false)).toBe('lambert')
  })
})

describe('stylizeObject', () => {
  it('converts shared materials once, keeping colour and vertex colours, and skips helpers', () => {
    const { root, wood, a, b, col } = model(DIORAMA_STYLE)
    const colMaterial = col.material
    stylizeObject(root, 'toon')
    expect(a.material).toBeInstanceOf(MeshLambertMaterial)
    expect(a.material).toBe(b.material)
    const toon = a.material as unknown as MeshLambertMaterial
    expect(toon.color.getHex()).toBe(wood.color.getHex())
    expect(toon.vertexColors).toBe(true)
    expect(toon.customProgramCacheKey()).toBe('toon|')
    expect(col.material).toBe(colMaterial)
  })

  it('starts from the original materials when called again with another mode', () => {
    const { root, wood, a } = model()
    stylizeObject(root, 'lambert')
    expect(a.material).toBeInstanceOf(MeshLambertMaterial)
    expect((a.material as unknown as MeshLambertMaterial).customProgramCacheKey()).not.toContain('toon')
    stylizeObject(root, 'keep')
    expect(a.material).toBe(wood)
  })

  it('gives rim-lit copies their own cache entry', () => {
    const src = new MeshStandardMaterial()
    const plain = convertMaterial(src, 'toon')
    const rim = convertMaterial(src, 'toon', true)
    expect(rim).not.toBe(plain)
    expect(convertMaterial(src, 'toon', true)).toBe(rim)
    expect(rim.customProgramCacheKey()).toBe('toon|rim')
    // A PBR copy can carry the rim but not the bands.
    expect(convertMaterial(src, 'keep', true).customProgramCacheKey()).toBe('|rim')
  })

  it('leaves unlit materials alone', () => {
    const basic = new MeshBasicMaterial()
    expect(convertMaterial(basic, 'toon')).toBe(basic)
  })
})

describe('toon bands', () => {
  it('quantise Lambert N·L into dark, three bands, and keep the shadow path', () => {
    expect(BANDED_LAMBERT).toContain('float nl = dot( geometryNormal, directLight.direction );')
    expect(BANDED_LAMBERT).not.toContain('saturate( dot( geometryNormal, directLight.direction ) )')
    const m = toonMaterial({ color: '#ffffff' })
    const shader = { uniforms: {}, fragmentShader: 'x\n#include <lights_lambert_pars_fragment>\nvoid main() {\n#include <opaque_fragment>\n}', vertexShader: '' }
    m.onBeforeCompile(shader as never, undefined as never)
    expect(shader.fragmentShader).toContain('float nl =')
    expect(shader.fragmentShader).not.toContain('rimColor')
  })
})

describe('outlines', () => {
  it('averages normals over a box corner so the hull does not split', () => {
    const geo = new BoxGeometry(1, 1, 1)
    const n = smoothNormals(geo)
    const pos = geo.getAttribute('position')
    const corner = new Vector3(0.5, 0.5, 0.5)
    const expected = corner.clone().normalize()
    let found = 0
    for (let i = 0; i < pos.count; i++) {
      if (new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).distanceTo(corner) > 1e-6) continue
      found++
      expect(n.getX(i)).toBeCloseTo(expected.x)
      expect(n.getY(i)).toBeCloseTo(expected.y)
      expect(n.getZ(i)).toBeCloseTo(expected.z)
    }
    expect(found).toBe(3)
    expect(smoothNormals(geo)).toBe(n)
  })

  it('adds one back-face hull per visible mesh and removes them again', () => {
    const { root, a, col } = model(DIORAMA_STYLE)
    col.visible = false
    const ink = outlineMaterial('#16110c', 0.02)
    const remove = addOutlines(root, ink)
    expect(a.children).toHaveLength(1)
    const hull = a.children[0] as Mesh
    expect(hull.geometry).toBe(a.geometry)
    expect(hull.material).toBe(ink)
    expect(hull.userData.outline).toBe('ink')
    expect(col.children).toHaveLength(0)
    // Outlines are not outlined again, and stylizing skips them.
    addOutlines(root, ink)()
    expect(a.children).toHaveLength(1)
    stylizeObject(root, 'toon')
    expect(hull.material).toBe(ink)
    remove()
    expect(a.children).toHaveLength(0)
    expect(outlineMaterial('#16110c', 0.02)).toBe(ink)
  })
})

describe('buildGlow', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('puts a sprite over each emissive mesh, in the root frame, outside the model', () => {
    const gradient = { addColorStop: () => {} }
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => gradient, fillRect: () => {}, fillStyle: '' }) }),
    })
    const root = new Group()
    root.scale.setScalar(2)
    const holder = new Group()
    holder.position.set(1, 0, 0)
    const flame = new Mesh(new BoxGeometry(0.2, 0.4, 0.2), new MeshStandardMaterial({ emissive: '#ff6a00', emissiveIntensity: 2 }))
    flame.position.set(0, 1, 0)
    holder.add(flame)
    root.add(holder, new Mesh(new BoxGeometry(), new MeshStandardMaterial()))
    expect(isGlowing(flame.material)).toBe(true)
    const glow = buildGlow(root)!
    expect(glow.group.children).toHaveLength(1)
    const sprite = glow.group.children[0] as Sprite
    expect(sprite.position.x).toBeCloseTo(1)
    expect(sprite.position.y).toBeCloseTo(1)
    expect(sprite.scale.x).toBeCloseTo(0.4 * 3.2)
    expect(holder.children).toHaveLength(1)
    glow.dispose()
  })

  it('returns null when nothing glows', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {} }) }),
    })
    expect(buildGlow(model(DIORAMA_STYLE).root)).toBeNull()
  })
})
