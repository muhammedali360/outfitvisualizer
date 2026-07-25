import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Category } from '../types'

/**
 * Garment cutouts are wrapped onto open cylinder arcs ("shells") around the
 * body — one facing front, a twin facing back — so the outfit reads as
 * dressed from every orbit angle. All sizes are in mannequin units
 * (floor at y=0, top of head ≈ 3.3).
 */
interface ShellSpec {
  radius: number
  arc: number
  anchor: 'top' | 'bottom'
  anchorY: number
  minH: number
  maxH: number
}

const SHELLS: Record<Category, ShellSpec> = {
  hat: { radius: 0.36, arc: Math.PI * 1.15, anchor: 'bottom', anchorY: 3.0, minH: 0.28, maxH: 0.8 },
  top: { radius: 0.72, arc: Math.PI * 1.1, anchor: 'top', anchorY: 2.78, minH: 0.9, maxH: 1.6 },
  // A wider radius than the top so the layer genuinely wraps outside it.
  layer: { radius: 0.82, arc: Math.PI * 1.16, anchor: 'top', anchorY: 2.84, minH: 1.0, maxH: 1.8 },
  bottom: { radius: 0.52, arc: Math.PI * 1.1, anchor: 'top', anchorY: 1.85, minH: 1.0, maxH: 1.75 },
  shoes: { radius: 0.46, arc: Math.PI, anchor: 'bottom', anchorY: 0.02, minH: 0.25, maxH: 0.55 },
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  garments: THREE.Group
}

export default function Avatar3D({ images }: { images: Partial<Record<Category, string>> }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<Ctx | null>(null)
  const versionRef = useRef(0)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
    camera.position.set(0, 2.1, 6.4)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xffffff, 0xbfae9c, 1.15))
    const sun = new THREE.DirectionalLight(0xffffff, 1.3)
    sun.position.set(2.5, 5, 3)
    scene.add(sun)

    scene.add(buildMannequin())

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 40),
      new THREE.MeshBasicMaterial({ color: 0x1e1912, transparent: true, opacity: 0.09 }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.001
    scene.add(shadow)

    const garments = new THREE.Group()
    scene.add(garments)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.7, 0)
    controls.enablePan = false
    controls.enableDamping = true
    controls.minDistance = 3
    controls.maxDistance = 10
    controls.minPolarAngle = 0.7
    controls.maxPolarAngle = 1.8
    controls.autoRotate = true
    controls.autoRotateSpeed = 1.4
    controls.addEventListener('start', () => {
      controls.autoRotate = false
    })

    let raf = 0
    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    ctxRef.current = { renderer, scene, camera, controls, garments }

    return () => {
      versionRef.current++
      ctxRef.current = null
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse(disposeMesh)
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const version = ++versionRef.current
    for (const child of [...ctx.garments.children]) {
      ctx.garments.remove(child)
      child.traverse(disposeMesh)
    }
    for (const cat of Object.keys(SHELLS) as Category[]) {
      const url = images[cat]
      if (!url) continue
      new THREE.TextureLoader().load(url, tex => {
        const live = ctxRef.current
        if (!live || versionRef.current !== version) {
          tex.dispose()
          return
        }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        live.garments.add(buildShellPair(cat, tex))
      })
    }
  }, [images])

  return <div ref={mountRef} className="avatar3d" />
}

function buildShellPair(cat: Category, tex: THREE.Texture): THREE.Group {
  const spec = SHELLS[cat]
  const img = tex.image as { width?: number; height?: number }
  const aspect = (img.width ?? 1) / Math.max(1, img.height ?? 1)
  const effWidth = 1.9 * spec.radius
  const height = Math.min(spec.maxH, Math.max(spec.minH, effWidth / aspect))
  const centerY = spec.anchor === 'top' ? spec.anchorY - height / 2 : spec.anchorY + height / 2

  const geo = new THREE.CylinderGeometry(
    spec.radius,
    spec.radius,
    height,
    36,
    1,
    true,
    -spec.arc / 2,
    spec.arc,
  )
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const group = new THREE.Group()
  const front = new THREE.Mesh(geo, mat)
  front.position.y = centerY
  const back = new THREE.Mesh(geo, mat)
  back.position.y = centerY
  back.rotation.y = Math.PI
  group.add(front, back)
  return group
}

function buildMannequin(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xddd6cb, roughness: 0.95 })
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.z = rz
    g.add(m)
    return m
  }

  add(new THREE.SphereGeometry(0.27, 24, 18), 0, 3.02, 0).scale.set(1, 1.15, 1)
  add(new THREE.CylinderGeometry(0.09, 0.11, 0.24, 12), 0, 2.72, 0)
  add(new THREE.CapsuleGeometry(0.4, 0.75, 6, 20), 0, 2.2, 0).scale.set(1, 1, 0.62)
  add(new THREE.SphereGeometry(0.38, 20, 14), 0, 1.72, 0).scale.set(1, 0.75, 0.68)
  add(new THREE.CapsuleGeometry(0.1, 0.95, 4, 12), -0.56, 2.16, 0, 0.14)
  add(new THREE.CapsuleGeometry(0.1, 0.95, 4, 12), 0.56, 2.16, 0, -0.14)
  add(new THREE.CapsuleGeometry(0.14, 1.25, 4, 14), -0.19, 0.95, 0)
  add(new THREE.CapsuleGeometry(0.14, 1.25, 4, 14), 0.19, 0.95, 0)
  add(new THREE.SphereGeometry(0.15, 16, 12), -0.19, 0.1, 0.12).scale.set(1, 0.55, 1.7)
  add(new THREE.SphereGeometry(0.15, 16, 12), 0.19, 0.1, 0.12).scale.set(1, 0.55, 1.7)
  return g
}

function disposeMesh(obj: THREE.Object3D) {
  if (obj instanceof THREE.Mesh) {
    obj.geometry.dispose()
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      const mapped = m as THREE.MeshBasicMaterial
      mapped.map?.dispose()
      m.dispose()
    }
  }
}
