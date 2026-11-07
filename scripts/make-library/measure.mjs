// Dev helper: prints bounds (x y z size), triangle count and texture info for source models.
// Usage: node scripts/make-library/measure.mjs <file-or-dir>...
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

function* files(p) {
  if (statSync(p).isDirectory()) for (const n of readdirSync(p).sort()) yield* files(path.join(p, n))
  else if (/\.(glb|gltf)$/i.test(p)) yield p
}

for (const arg of process.argv.slice(2)) {
  for (const f of files(arg)) {
    const doc = await io.read(f)
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
    const b = getBounds(scene)
    let tris = 0
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const idx = p.getIndices()
      tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3
    }
    const size = b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' ')
    const tex = doc.getRoot().listTextures().length
    const minY = b.min[1].toFixed(2)
    console.log(`${path.basename(f).padEnd(44)} ${size.padEnd(20)} minY ${minY.padStart(6)} tris ${String(tris).padStart(6)} tex ${tex} mats ${doc.getRoot().listMaterials().length}`)
  }
}
