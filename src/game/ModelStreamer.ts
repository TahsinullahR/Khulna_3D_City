import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

type ModelEntry = {
  id: string
  url: string
  position: [number, number, number]
  scale?: number | [number, number, number]
  rotationY?: number
  radius?: number
  lodUrl?: string
}

type ModelManifest = { models: ModelEntry[] }
type LoadedModel = { root: THREE.Group; url: string }

const MANIFEST_URL = '/models/manifest.json'
const DEFAULT_LOAD_RADIUS = 190
const DEFAULT_UNLOAD_RADIUS = 240
const LOD_SWITCH_DISTANCE = 115

/**
 * Optional asset streamer for licensed GLB/GLTF assets.
 * Add entries to public/models/manifest.json; missing assets fail gracefully.
 */
export class ModelStreamer {
  private loader = new GLTFLoader()
  private manifest: ModelEntry[] = []
  private loaded = new Map<string, LoadedModel>()
  private loading = new Set<string>()
  private failed = new Set<string>()
  private cache = new Map<string, THREE.Group>()
  private lastCheck = 0
  private disposed = false

  constructor(private scene: THREE.Scene) {
    void this.readManifest()
  }

  private async readManifest() {
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-cache' })
      if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`)
      const data = await response.json() as ModelManifest
      if (!Array.isArray(data.models)) throw new Error('Invalid model manifest')
      this.manifest = data.models.filter(item =>
        typeof item.id === 'string' && typeof item.url === 'string' &&
        Array.isArray(item.position) && item.position.length === 3 &&
        item.position.every(Number.isFinite),
      )
      console.info(`Model streamer ready: ${this.manifest.length} manifest entries.`)
    } catch (error) {
      // An empty/missing manifest must never prevent the base game from starting.
      console.info('Optional 3D model manifest not available; using built-in city assets.', error)
    }
  }

  update(focus: THREE.Vector3) {
    if (this.disposed || performance.now() - this.lastCheck < 350) return
    this.lastCheck = performance.now()

    for (const entry of this.manifest) {
      const [x, y, z] = entry.position
      const distance = Math.hypot(focus.x - x, focus.y - y, focus.z - z)
      const loadRadius = entry.radius ?? DEFAULT_LOAD_RADIUS
      const active = this.loaded.get(entry.id)

      if (distance > DEFAULT_UNLOAD_RADIUS) {
        if (active) {
          this.scene.remove(active.root)
          this.loaded.delete(entry.id)
        }
        continue
      }

      const wantedUrl = entry.lodUrl && distance > LOD_SWITCH_DISTANCE ? entry.lodUrl : entry.url
      if (active?.url === wantedUrl || this.loading.has(entry.id) || this.failed.has(`${entry.id}:${wantedUrl}`)) continue
      if (distance > loadRadius && !active) continue
      this.loading.add(entry.id)
      void this.load(entry, wantedUrl)
    }
  }

  private async load(entry: ModelEntry, url: string) {
    try {
      let template = this.cache.get(url)
      if (!template) {
        const gltf = await this.loader.loadAsync(url)
        template = new THREE.Group()
        template.add(gltf.scene)
        this.cache.set(url, template)
      }
      if (this.disposed) return

      const old = this.loaded.get(entry.id)
      if (old) this.scene.remove(old.root)
      const root = template.clone(true)
      root.position.set(...entry.position)
      if (typeof entry.scale === 'number') root.scale.setScalar(entry.scale)
      else if (entry.scale) root.scale.set(...entry.scale)
      if (entry.rotationY) root.rotation.y = entry.rotationY
      root.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.frustumCulled = true
          object.castShadow = false
          object.receiveShadow = false
        }
      })
      this.scene.add(root)
      this.loaded.set(entry.id, { root, url })
    } catch (error) {
      this.failed.add(`${entry.id}:${url}`)
      console.warn(`Unable to load optional model "${entry.id}" from ${url}.`, error)
    } finally {
      this.loading.delete(entry.id)
    }
  }

  dispose() {
    this.disposed = true
    const disposeTree = (root: THREE.Object3D) => {
      root.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach(material => material.dispose())
          else object.material.dispose()
        }
      })
    }
    for (const { root } of this.loaded.values()) {
      this.scene.remove(root)
      disposeTree(root)
    }
    this.loaded.clear()
    this.loading.clear()
    // Dispose cached source scenes too; geometry/material disposal is safe if shared
    // resources were already disposed through a cloned instance.
    for (const template of this.cache.values()) disposeTree(template)
    this.cache.clear()
  }
}
