/**
 * 3D preview for the real-size confirm step: the optimised model on a 1.5 m grid cell with a
 * 1.8 m figure beside it, so the GM can judge the size at a glance. Drag to turn. Plain three.js
 * (no R3F) and loaded lazily with the import dialog.
 */
import { useEffect, useRef } from 'react'
import {
  Box3, CapsuleGeometry, Color, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial,
  PlaneGeometry, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { disposeObject, loadGlb, stageModel } from '@/import/model/thumbnail'

const CELL = 1.5
const FIGURE = 1.8

export default function ModelPreview({ glb, scale, label }: { glb: Uint8Array; scale: number; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  const wrapper = useRef<Group | null>(null)
  const redraw = useRef<(() => void) | null>(null)
  const scaleNow = useRef(scale)
  scaleNow.current = scale

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let cleanup = () => {}
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    el.appendChild(canvas)
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch {
      el.textContent = 'The 3D preview needs WebGL.'
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    loadGlb(glb).then(({ scene: model, dispose }) => {
      if (disposed) { dispose(); return }
      const group = new Group()
      group.add(model)
      wrapper.current = group
      const box = new Box3().setFromObject(model, true)
      const w = Math.max(box.max.x - box.min.x, 0.1)

      // Stage the model plus the reference props so the camera frames them all.
      const refs = new Group()
      const cell = new LineSegments(new EdgesGeometry(new PlaneGeometry(CELL, CELL)), new LineBasicMaterial({ color: new Color('#8b6424') }))
      cell.rotation.x = -Math.PI / 2
      refs.add(cell)
      const figure = new Mesh(new CapsuleGeometry(0.22, FIGURE - 0.44, 4, 12), new MeshStandardMaterial({ color: '#7cc4ff', transparent: true, opacity: 0.45, roughness: 0.9 }))
      figure.position.set(-(w / 2 + 0.5), FIGURE / 2, 0)
      refs.add(figure)
      const all = new Group()
      all.add(group, refs)
      const { scene, camera, target } = stageModel(all, 1)
      const controls = new OrbitControls(camera, canvas)
      controls.target.copy(target)
      controls.enablePan = false
      controls.update()

      const resize = () => {
        const size = Math.max(160, el.clientWidth)
        const h = Math.max(160, el.clientHeight || size * 0.75)
        renderer.setSize(size, h, false)
        camera.aspect = size / h
        camera.updateProjectionMatrix()
        render()
      }
      const render = () => renderer.render(scene, camera)
      redraw.current = () => {
        // Re-frame on rescale so the model stays in view.
        const b = new Box3().setFromObject(all, true)
        const center = b.getCenter(new Vector3())
        const radius = b.getSize(new Vector3()).length() / 2
        const dir = camera.position.clone().sub(controls.target).normalize()
        controls.target.copy(center)
        camera.position.copy(center).addScaledVector(dir, Math.max(radius, 0.5) * 3.6)
        camera.near = radius / 100
        camera.far = radius * 100
        camera.updateProjectionMatrix()
        controls.update()
        figure.position.x = -(w * group.scale.x / 2 + 0.5)
        render()
      }
      controls.addEventListener('change', render)
      const ro = new ResizeObserver(resize)
      ro.observe(el)
      resize()
      if (scaleNow.current !== 1) {
        group.scale.setScalar(scaleNow.current)
        redraw.current()
      }
      cleanup = () => {
        ro.disconnect()
        controls.dispose()
        dispose()
        disposeObject(refs)
        cell.geometry.dispose()
        ;(cell.material as LineBasicMaterial).dispose()
      }
    }).catch(() => { if (!disposed) el.textContent = 'The preview could not load this model.' })
    return () => {
      disposed = true
      cleanup()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      wrapper.current = null
      redraw.current = null
    }
  }, [glb])

  useEffect(() => {
    if (!wrapper.current) return
    wrapper.current.scale.setScalar(scale)
    redraw.current?.()
  }, [scale])

  return <div ref={host} className="import-preview" role="img" aria-label={label} />
}
