/**
 * The "candle-lit miniature diorama" look at load time. Library GLBs (root `userData.style ===
 * 'diorama'`, see scripts/make-scenes/lib.mjs) carry baked vertex colours (gradient + AO) and get
 * three-band toon shading on every graphics tier. Imported GLBs keep their PBR materials on
 * medium and high and switch to Lambert below. Minis add an inverted-hull outline and a rim light
 * so they separate from the floor without real-time shadows.
 *
 * Converted materials are cached per source material, so the shared materials of a cached GLB stay
 * shared across every clone; they live as long as the page.
 */
import {
  AdditiveBlending, BackSide, Box3, BufferAttribute, CanvasTexture, Color, Group, Material, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshStandardMaterial, MeshToonMaterial, Object3D, ShaderChunk, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
  type BufferGeometry, type MeshLambertMaterialParameters, type WebGLProgramParametersWithUniforms,
} from 'three'

export type MaterialMode = 'toon' | 'lambert' | 'keep'

/** Root flag the generator scripts set on every library model. */
export const DIORAMA_STYLE = 'diorama'

export function isDiorama(root: Object3D): boolean {
  return root.userData?.style === DIORAMA_STYLE
}

/** Toon for library models on every tier; imported models keep PBR when the tier allows it. */
export function materialModeFor(root: Object3D, pbr: boolean): MaterialMode {
  if (isDiorama(root)) return 'toon'
  return pbr ? 'keep' : 'lambert'
}

/**
 * Light levels of the three toon bands (shadow side, mid, lit), as fractions of full light, and
 * the N·L thresholds between them. Below the first threshold a surface faces away and gets none.
 */
export const TOON_BANDS = [0.42, 0.72, 1] as const
export const TOON_STEPS = [0.04, 0.33, 0.66] as const

/** Half-width of the soft edge between two bands, in N·L. */
const TOON_EDGE = 0.04

/**
 * Lambert lighting with N·L quantised to the toon bands (soft-edged so the steps do not shimmer).
 * Built on Lambert rather than MeshToonMaterial because three's toon shading samples its gradient
 * over the whole -1..1 range and so lights faces turned away from a light (walls glow from behind
 * a torch); here the back side stays dark and the shadow path is Lambert's own.
 */
const f = (n: number) => n.toFixed(3)
export const BANDED_LAMBERT = ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  [
    'float nl = dot( geometryNormal, directLight.direction );',
    `float dotNL = ${f(TOON_BANDS[0])} * smoothstep( ${f(TOON_STEPS[0] - TOON_EDGE)}, ${f(TOON_STEPS[0] + TOON_EDGE)}, nl )`,
    `  + ${f(TOON_BANDS[1] - TOON_BANDS[0])} * smoothstep( ${f(TOON_STEPS[1] - TOON_EDGE)}, ${f(TOON_STEPS[1] + TOON_EDGE)}, nl )`,
    `  + ${f(TOON_BANDS[2] - TOON_BANDS[1])} * smoothstep( ${f(TOON_STEPS[2] - TOON_EDGE)}, ${f(TOON_STEPS[2] + TOON_EDGE)}, nl );`,
  ].join('\n'),
)

/* ---------------------------------------------------------------- rim light */

const RIM_COLOR = new Color('#f3ead8')
const RIM_STRENGTH = 0.32
const RIM_POWER = 2.6

/**
 * Shader patches for the look: `toon` bands the light (Lambert only), `rim` adds a Fresnel rim
 * after lighting that brightens the silhouette like a back light (any lit built-in material: they
 * all expose `vViewPosition`, `normal` and `outgoingLight`).
 */
export function patchMaterial(material: Material, { toon = false, rim = false }: { toon?: boolean; rim?: boolean }): void {
  const bands = toon && material instanceof MeshLambertMaterial
  if (!bands && !rim) return
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    if (bands) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>', BANDED_LAMBERT)
    if (!rim) return
    shader.uniforms.rimColor = { value: RIM_COLOR }
    shader.uniforms.rimStrength = { value: RIM_STRENGTH }
    shader.uniforms.rimPower = { value: RIM_POWER }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 rimColor;\nuniform float rimStrength;\nuniform float rimPower;\nvoid main() {')
      .replace('#include <opaque_fragment>', [
        'float rimFacing = 1.0 - saturate( dot( normalize( vViewPosition ), normal ) );',
        'outgoingLight += rimColor * pow( rimFacing, rimPower ) * rimStrength;',
        '#include <opaque_fragment>',
      ].join('\n'))
  }
  material.customProgramCacheKey = () => `${bands ? 'toon' : ''}|${rim ? 'rim' : ''}`
}

/** A new toon-shaded material (banded Lambert), optionally rim-lit. */
export function toonMaterial(params: MeshLambertMaterialParameters = {}, rim = false): MeshLambertMaterial {
  const m = new MeshLambertMaterial(params)
  patchMaterial(m, { toon: true, rim })
  return m
}

/* ---------------------------------------------------------------- material conversion */

type Lit = MeshStandardMaterial | MeshToonMaterial | MeshLambertMaterial

function isLit(m: Material): m is Lit {
  return m instanceof MeshStandardMaterial || m instanceof MeshToonMaterial || m instanceof MeshLambertMaterial
}

function copyCommon(from: Lit, to: MeshLambertMaterial): void {
  to.name = from.name
  to.color.copy(from.color)
  to.map = from.map
  to.vertexColors = from.vertexColors
  to.emissive.copy(from.emissive)
  to.emissiveIntensity = from.emissiveIntensity
  to.emissiveMap = from.emissiveMap
  to.alphaMap = from.alphaMap
  to.normalMap = from.normalMap
  to.transparent = from.transparent
  to.opacity = from.opacity
  to.alphaTest = from.alphaTest
  to.side = from.side
  to.depthWrite = from.depthWrite
  to.visible = from.visible
}

const converted = new Map<MaterialMode | `${MaterialMode}+rim`, WeakMap<Material, Material>>()

/** The material to render `src` with in `mode`; cached so shared materials stay shared. */
export function convertMaterial(src: Material, mode: MaterialMode, rim = false): Material {
  if (mode === 'keep' && !rim) return src
  if (!isLit(src)) return src // unlit, sprites, custom shaders: leave alone
  const key = rim ? (`${mode}+rim` as const) : mode
  let cache = converted.get(key)
  if (!cache) { cache = new WeakMap(); converted.set(key, cache) }
  const hit = cache.get(src)
  if (hit) return hit
  let out: Material
  if (mode === 'keep') {
    out = src.clone()
  } else {
    const m = new MeshLambertMaterial()
    copyCommon(src, m)
    out = m
  }
  patchMaterial(out, { toon: mode === 'toon', rim })
  cache.set(src, out)
  return out
}

/** Helpers that never render (colliders, fog regions). */
const HELPER = /^(COL|FOG)_/

const sourceMaterials = new WeakMap<Mesh, Material | Material[]>()

/**
 * Swap every visible mesh's materials for `mode`. The source materials are remembered on the mesh,
 * so calling it again with another mode starts from the originals.
 */
export function stylizeObject(root: Object3D, mode: MaterialMode, { rim = false }: { rim?: boolean } = {}): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh) || HELPER.test(o.name) || o.userData.outline) return
    let src = sourceMaterials.get(o)
    if (!src) { src = o.material as Material | Material[]; sourceMaterials.set(o, src) }
    o.material = Array.isArray(src) ? src.map((m) => convertMaterial(m, mode, rim)) : convertMaterial(src, mode, rim)
  })
}

/* ---------------------------------------------------------------- inverted-hull outlines */

/**
 * Per-vertex normals averaged over every vertex sharing a position, so the hull of a flat-shaded box
 * extrudes as one closed shell instead of splitting at the corners. Cached on the geometry.
 */
export function smoothNormals(geometry: BufferGeometry): BufferAttribute {
  const cached = geometry.getAttribute('outlineNormal') as BufferAttribute | undefined
  if (cached) return cached
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const pos = geometry.getAttribute('position')
  const nor = geometry.getAttribute('normal')
  const sums = new Map<string, Vector3>()
  const keys: string[] = new Array(pos.count)
  const q = (v: number) => Math.round(v * 1e4)
  for (let i = 0; i < pos.count; i++) {
    const k = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`
    keys[i] = k
    let s = sums.get(k)
    if (!s) { s = new Vector3(); sums.set(k, s) }
    s.x += nor.getX(i); s.y += nor.getY(i); s.z += nor.getZ(i)
  }
  const out = new Float32Array(pos.count * 3)
  const tmp = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    tmp.copy(sums.get(keys[i]!)!)
    if (tmp.lengthSq() < 1e-12) tmp.set(nor.getX(i), nor.getY(i), nor.getZ(i))
    tmp.normalize()
    out[i * 3] = tmp.x; out[i * 3 + 1] = tmp.y; out[i * 3 + 2] = tmp.z
  }
  const attr = new BufferAttribute(out, 3)
  geometry.setAttribute('outlineNormal', attr)
  return attr
}

const outlineMaterials = new Map<string, MeshBasicMaterial>()

/**
 * Unlit back-face material that pushes every vertex out along its smoothed normal in view space,
 * by `thickness` world units, so the outline width does not depend on the mesh's own scale.
 */
export function outlineMaterial(color: string, thickness: number, opacity = 1): MeshBasicMaterial {
  const key = `${color}|${thickness.toFixed(4)}|${opacity}`
  let m = outlineMaterials.get(key)
  if (m) return m
  m = new MeshBasicMaterial({ color, side: BackSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineThickness = { value: thickness }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec3 outlineNormal;\nuniform float outlineThickness;\nvoid main() {')
      .replace('#include <project_vertex>', [
        'vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );',
        'mvPosition.xyz += normalize( normalMatrix * outlineNormal ) * outlineThickness;',
        'gl_Position = projectionMatrix * mvPosition;',
      ].join('\n'))
  }
  m.customProgramCacheKey = () => `outline:${thickness.toFixed(4)}`
  outlineMaterials.set(key, m)
  return m
}

/** Ink colour of mini outlines: warm near-black, not pure black, so it reads as paint. */
export const OUTLINE_INK = '#16110c'

/**
 * Adds an outline hull (a child sharing the geometry) to every visible mesh under `root`, tagged
 * `userData.outline = tag`. Returns a function that removes them again.
 */
export function addOutlines(root: Object3D, material: MeshBasicMaterial, tag = 'ink'): () => void {
  const hulls: Mesh[] = []
  const targets: Mesh[] = []
  root.traverse((o) => {
    if (o instanceof Mesh && o.visible && !HELPER.test(o.name) && !o.userData.outline && !(o as { isSkinnedMesh?: boolean }).isSkinnedMesh) targets.push(o)
  })
  for (const o of targets) {
    smoothNormals(o.geometry)
    const hull = new Mesh(o.geometry, material)
    hull.name = `${o.name}_outline`
    hull.userData.outline = tag
    hull.castShadow = false
    hull.receiveShadow = false
    hull.raycast = () => undefined
    o.add(hull)
    hulls.push(hull)
  }
  return () => { for (const h of hulls) h.removeFromParent() }
}

/* ---------------------------------------------------------------- glow (high tier) */

let glowTexture: CanvasTexture | null = null
function glowMap(): CanvasTexture | null {
  if (glowTexture) return glowTexture
  if (typeof document === 'undefined') return null
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  glowTexture = new CanvasTexture(canvas)
  glowTexture.colorSpace = SRGBColorSpace
  return glowTexture
}

/** Emissive enough to glow: a visible mesh whose material lights itself. */
export function isGlowing(m: Material): boolean {
  return isLit(m) && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.3
}

const tmpBox = new Box3()
const tmpSize = new Vector3()
const tmpInverse = new Matrix4()
const tmpRelative = new Matrix4()

/**
 * Selective glow without post-processing: a soft additive sprite over every emissive mesh, sized to
 * it. The sprites live in their own group, in `root`'s local frame, so they never count towards
 * the model's bounds (footprints, cell fitting); render it next to `root` with the same transform.
 * Null when nothing glows.
 */
export function buildGlow(root: Object3D): { group: Group; dispose(): void } | null {
  const map = glowMap()
  if (!map) return null
  root.updateWorldMatrix(true, true)
  tmpInverse.copy(root.matrixWorld).invert()
  const group = new Group()
  group.name = 'glow'
  const materials: SpriteMaterial[] = []
  root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible || HELPER.test(o.name) || o.userData.outline) return
    const mat = (Array.isArray(o.material) ? o.material : [o.material]).find((m: Material) => isGlowing(m)) as Lit | undefined
    if (!mat) return
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    if (!o.geometry.boundingBox) return
    tmpRelative.multiplyMatrices(tmpInverse, o.matrixWorld)
    tmpBox.copy(o.geometry.boundingBox).applyMatrix4(tmpRelative)
    tmpBox.getSize(tmpSize)
    const size = Math.max(tmpSize.x, tmpSize.y, tmpSize.z) * 3.2
    const material = new SpriteMaterial({
      map, color: mat.emissive.clone(), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55,
    })
    materials.push(material)
    const sprite = new Sprite(material)
    tmpBox.getCenter(sprite.position)
    sprite.scale.set(size, size, 1)
    sprite.raycast = () => undefined
    group.add(sprite)
  })
  if (materials.length === 0) return null
  return { group, dispose: () => { for (const m of materials) m.dispose() } }
}
