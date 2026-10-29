import * as THREE from 'three'

export type GameStatus = 'loading' | 'ready' | 'paused' | 'error'
type GameCallbacks = {
  onStatus: (status: GameStatus) => void
  onMessage: (message: string) => void
  onSpeed: (speed: number) => void
  onMapSource: (source: 'loading' | 'osm' | 'fallback') => void
}

type OSMElement = {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
}

type OSMResponse = { elements: OSMElement[] }

const CENTER = { lat: 22.8145, lon: 89.5480 }
// A deliberately bounded first district around central Khulna.
// Expand only after measuring browser and mobile performance.
const BBOX = { south: 22.805, west: 89.535, north: 22.824, east: 89.561 }
const METERS_PER_LAT = 111_320
const METERS_PER_LON = 111_320 * Math.cos(CENTER.lat * Math.PI / 180)

export class KhulnaGame {
  private renderer: THREE.WebGLRenderer | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2500)
  private player = new THREE.Group()
  private playerBody: THREE.Mesh | null = null
  private playerHead: THREE.Mesh | null = null
  private keys = new Set<string>()
  private touchKeys = new Set<string>()
  private obstacles: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = []
  private clock = new THREE.Clock()
  private raf = 0
  private paused = false
  private destroyed = false
  private pointerLocked = false
  private yaw = 0
  private pitch = -0.2
  private verticalVelocity = 0
  private grounded = true
  private velocity = new THREE.Vector3()
  private lastSpeedEmit = 0
  private mapGroup = new THREE.Group()
  private callbacks: GameCallbacks
  private canvas: HTMLCanvasElement
  private resizeObserver: ResizeObserver | null = null
  private pointerDown = false
  private lastPointer = { x: 0, y: 0 }
  private cameraTarget = new THREE.Vector3()
  private materials: THREE.Material[] = []

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.canvas = canvas
    this.callbacks = callbacks
  }

  async start() {
    try {
      this.setupRenderer()
      this.setupScene()
      this.setupPlayer()
      this.scene.add(this.mapGroup)
      this.installEvents()
      this.callbacks.onMessage('Loading mapped roads and buildings around central Khulna…')
      const loaded = await this.loadOSM()
      if (this.destroyed) return
      if (loaded) {
        this.callbacks.onMapSource('osm')
        this.callbacks.onMessage('Real OpenStreetMap road and building geometry loaded.')
      } else {
        // An incomplete OSM response may have created a few meshes before validation failed.
        // Clear it before constructing the fallback so the scene never mixes partial datasets.
        this.clearMapGroup()
        this.buildFallbackDistrict()
        this.callbacks.onMapSource('fallback')
        this.callbacks.onMessage('Map service unavailable; using the local playable prototype.')
      }
      this.callbacks.onStatus('ready')
      this.resize()
      this.renderer?.render(this.scene, this.camera)
      this.loop()
    } catch (error) {
      console.error('Khulna game failed to initialize:', error)
      this.callbacks.onStatus('error')
      this.callbacks.onMessage(error instanceof Error ? error.message : 'Unable to initialize the 3D game.')
    }
  }

  private setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: window.devicePixelRatio <= 1.5,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.setSize(this.canvas.clientWidth || 800, this.canvas.clientHeight || 500, false)
    this.renderer.shadowMap.enabled = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
  }

  private setupScene() {
    this.scene.background = new THREE.Color('#a9c3d0')
    this.scene.fog = new THREE.Fog('#a9c3d0', 150, 900)
    this.camera.position.set(0, 5, 10)

    const hemi = new THREE.HemisphereLight('#e8f4ff', '#77715d', 2.0)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff1d2', 2.6)
    sun.position.set(-120, 180, 90)
    this.scene.add(sun)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshStandardMaterial({ color: '#777f70', roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.08
    ground.receiveShadow = true
    this.scene.add(ground)

    const horizon = new THREE.GridHelper(1800, 180, '#8d9689', '#828b80')
    horizon.position.y = -0.06
    const gridMaterial = horizon.material as THREE.Material
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.12
    this.scene.add(horizon)
  }

  private setupPlayer() {
    const skin = new THREE.MeshStandardMaterial({ color: '#c98e65', roughness: 0.9 })
    const shirt = new THREE.MeshStandardMaterial({ color: '#d9ded8', roughness: 0.8 })
    const trousers = new THREE.MeshStandardMaterial({ color: '#273746', roughness: 0.9 })
    this.materials.push(skin, shirt, trousers)

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.72, 4, 8), shirt)
    body.position.y = 1.0
    body.castShadow = false
    this.player.add(body)
    this.playerBody = body

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin)
    head.position.y = 1.72
    this.player.add(head)
    this.playerHead = head

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.3), trousers)
    legs.position.set(0, 0.32, 0)
    this.player.add(legs)

    this.player.position.set(0, 0, 0)
    this.scene.add(this.player)
    this.cameraTarget.set(0, 1.3, 0)
  }

  private localPosition(lat: number, lon: number) {
    return {
      x: (lon - CENTER.lon) * METERS_PER_LON,
      z: -(lat - CENTER.lat) * METERS_PER_LAT,
    }
  }

  private async loadOSM(): Promise<boolean> {
    const query = `[out:json][timeout:22];(way["highway"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});way["building"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});way["waterway"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});way["leisure"="park"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});way["landuse"~"grass|forest|recreation_ground"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});way["natural"="water"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out body geom;`
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ]

    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 20_000)
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: 'data=' + encodeURIComponent(query),
          signal: controller.signal,
        })
        if (!response.ok) {
          window.clearTimeout(timeout)
          continue
        }
        window.clearTimeout(timeout)
        const data = await response.json() as OSMResponse
        if (!Array.isArray(data.elements) || data.elements.length < 5) continue
        try {
          this.renderOSM(data.elements)
          return true
        } catch (error) {
          console.warn('Invalid or incomplete OSM data; trying next endpoint:', error)
          this.clearMapGroup()
        }
      } catch (error) {
        console.warn('OSM endpoint unavailable:', endpoint, error)
      }
    }
    return false
  }

  private renderOSM(elements: OSMElement[]) {
    const roadMaterial = new THREE.MeshStandardMaterial({ color: '#303940', roughness: 0.96 })
    const roadEdgeMaterial = new THREE.MeshStandardMaterial({ color: '#737873', roughness: 1 })
    const laneMaterial = new THREE.MeshStandardMaterial({ color: '#d8d1b6', roughness: 0.9 })
    const waterMaterial = new THREE.MeshStandardMaterial({ color: '#5e9fa8', roughness: 0.55, metalness: 0.05 })
    const greenMaterial = new THREE.MeshStandardMaterial({ color: '#687f5b', roughness: 1, side: THREE.DoubleSide })
    const buildingPalette = ['#b9b5aa', '#c9c2b5', '#aeb9b5', '#d2c8b8', '#a8ada8', '#c5b7a8']
    let buildingIndex = 0
    let roadCount = 0
    let buildingCount = 0

    for (const element of elements) {
      const points = element.geometry
      if (!points || points.length < 2) continue
      const coords = points.map(p => this.localPosition(p.lat, p.lon))
      const tags = element.tags ?? {}

      if (tags.highway || tags.waterway) {
        const highway = tags.highway || ''
        const width = tags.waterway ? (tags.waterway === 'river' ? 9 : 3.5)
          : highway === 'motorway' || highway === 'trunk' || highway === 'primary' ? 7.5
          : highway === 'secondary' ? 6 : highway === 'tertiary' ? 4.8
          : highway === 'residential' || highway === 'unclassified' ? 4 : 2.8
        const surfaceMaterial = tags.waterway ? waterMaterial : roadMaterial
        for (let i = 0; i < coords.length - 1; i++) {
          const a = coords[i], b = coords[i + 1]
          const dx = b.x - a.x, dz = b.z - a.z
          const length = Math.hypot(dx, dz)
          if (length < 0.5 || length > 500) continue
          const angle = -Math.atan2(dx, dz)
          if (tags.highway && width >= 4.8) {
            const edge = new THREE.Mesh(new THREE.PlaneGeometry(width + 1.1, length), roadEdgeMaterial)
            edge.rotation.x = -Math.PI / 2
            edge.rotation.z = angle
            edge.position.set((a.x + b.x) / 2, 0.008, (a.z + b.z) / 2)
            this.mapGroup.add(edge)
          }
          const road = new THREE.Mesh(new THREE.PlaneGeometry(width, length), surfaceMaterial)
          road.rotation.x = -Math.PI / 2
          road.rotation.z = angle
          road.position.set((a.x + b.x) / 2, tags.waterway ? 0.018 : 0.015, (a.z + b.z) / 2)
          this.mapGroup.add(road)
          if (tags.highway && width >= 6 && length > 16) {
            const dashCount = Math.min(18, Math.floor(length / 10))
            for (let dash = 0; dash < dashCount; dash++) {
              const t = (dash + 0.5) / dashCount
              const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.09, Math.min(2.5, length / dashCount * 0.45)), laneMaterial)
              mark.rotation.x = -Math.PI / 2
              mark.rotation.z = angle
              mark.position.set(a.x + dx * t, 0.026, a.z + dz * t)
              this.mapGroup.add(mark)
            }
          }
          roadCount++
        }
      } else if ((tags.leisure === 'park' || ['grass', 'forest', 'recreation_ground'].includes(tags.landuse || '') || tags.natural === 'water') && coords.length >= 4) {
        const first = coords[0], last = coords[coords.length - 1]
        if (Math.hypot(first.x - last.x, first.z - last.z) > 1) continue
        const shape = new THREE.Shape()
        shape.moveTo(coords[0].x, -coords[0].z)
        for (let i = 1; i < coords.length - 1; i++) shape.lineTo(coords[i].x, -coords[i].z)
        shape.closePath()
        const isWater = tags.natural === 'water'
        const geometry = new THREE.ShapeGeometry(shape)
        geometry.rotateX(-Math.PI / 2)
        const area = new THREE.Mesh(geometry, isWater ? waterMaterial : greenMaterial)
        area.position.y = isWater ? 0.012 : 0.004
        this.mapGroup.add(area)
      } else if (tags.building) {
        const distinct = coords.filter((p, i) => i === 0 || Math.hypot(p.x - coords[i - 1].x, p.z - coords[i - 1].z) > 0.15)
        if (distinct.length < 3) continue
        const shape = new THREE.Shape()
        shape.moveTo(distinct[0].x, -distinct[0].z)
        for (let i = 1; i < distinct.length; i++) shape.lineTo(distinct[i].x, -distinct[i].z)
        shape.closePath()

        const levels = Number(tags['building:levels'] || 0)
        const heightTag = Number(tags.height || 0)
        const height = Math.max(3.2, Math.min(55, heightTag || (levels > 0 ? levels * 3.1 : 6 + (buildingIndex % 5) * 1.7)))
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 })
        geometry.rotateX(-Math.PI / 2)
        geometry.computeVertexNormals()
        const material = new THREE.MeshStandardMaterial({
          color: buildingPalette[buildingIndex % buildingPalette.length],
          roughness: 0.92,
          metalness: 0.02,
        })
        this.materials.push(material)
        const building = new THREE.Mesh(geometry, material)
        building.position.y = 0.03
        building.userData.name = tags.name || tags['name:en'] || 'Mapped building'
        this.mapGroup.add(building)

        const xs = distinct.map(p => p.x), zs = distinct.map(p => p.z)
        this.obstacles.push({
          minX: Math.min(...xs) - 0.35, maxX: Math.max(...xs) + 0.35,
          minZ: Math.min(...zs) - 0.35, maxZ: Math.max(...zs) + 0.35,
        })
        buildingIndex++
        buildingCount++
      }
    }

    // Source center is the initial spawn, with a small safety area around the player.
    this.obstacles = this.obstacles.filter(o => !(o.minX < 1.2 && o.maxX > -1.2 && o.minZ < 1.2 && o.maxZ > -1.2))
    console.info(`Khulna OSM district loaded: ${roadCount} road segments, ${buildingCount} building footprints.`)
    if (roadCount < 3 || buildingCount < 3) throw new Error('The returned map data was too small.')
  }

  private clearMapGroup() {
    for (const child of [...this.mapGroup.children]) {
      this.mapGroup.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach(material => material.dispose())
        else child.material.dispose()
      }
    }
    this.obstacles = []
  }

  private buildFallbackDistrict() {
    const asphalt = new THREE.MeshStandardMaterial({ color: '#343b40', roughness: 1 })
    const concrete = new THREE.MeshStandardMaterial({ color: '#b7b2a7', roughness: 1 })
    const buildingMaterials = [
      new THREE.MeshStandardMaterial({ color: '#c8c0b2', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#a9b8b4', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#d3c6b1', roughness: 0.9 }),
    ]
    const roadPositions = [-90, -60, -30, 0, 30, 60, 90]
    for (const z of roadPositions) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(220, 8), asphalt)
      road.rotation.x = -Math.PI / 2
      road.position.set(0, 0.01, z)
      this.mapGroup.add(road)
    }
    for (const x of roadPositions) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(8, 220), asphalt)
      road.rotation.x = -Math.PI / 2
      road.position.set(x, 0.012, 0)
      this.mapGroup.add(road)
    }

    for (let x = -105; x <= 105; x += 15) {
      for (let z = -105; z <= 105; z += 15) {
        if (Math.abs(x % 30) < 8 || Math.abs(z % 30) < 8 || (Math.abs(x) < 14 && Math.abs(z) < 14)) continue
        const w = 7 + Math.random() * 4
        const d = 6 + Math.random() * 4
        const h = 5 + Math.random() * 20
        const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), buildingMaterials[Math.floor(Math.random() * buildingMaterials.length)])
        building.position.set(x + (Math.random() - 0.5) * 3, h / 2, z + (Math.random() - 0.5) * 3)
        this.mapGroup.add(building)
        this.obstacles.push({ minX: building.position.x - w / 2, maxX: building.position.x + w / 2, minZ: building.position.z - d / 2, maxZ: building.position.z + d / 2 })
      }
    }
    this.materials.push(asphalt, concrete, ...buildingMaterials)
  }

  private installEvents() {
    const onKeyDown = (event: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
      this.keys.add(event.code)
      if (event.code === 'Escape') {
        if (this.pointerLocked) void document.exitPointerLock()
        this.pause()
      }
      if (event.code === 'Space' && this.grounded && !this.paused) {
        this.verticalVelocity = 7.2
        this.grounded = false
      }
    }
    const onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.code)
    const onBlur = () => { this.keys.clear(); this.touchKeys.clear(); this.pointerDown = false }
    const onPointerLock = () => { this.pointerLocked = document.pointerLockElement === this.canvas }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || this.paused) return
      this.pointerDown = true
      this.lastPointer = { x: event.clientX, y: event.clientY }
      if (event.pointerType === 'mouse' && window.matchMedia('(pointer:fine)').matches && !this.pointerLocked) {
        try {
          const lockResult = this.canvas.requestPointerLock()
          if (lockResult && typeof lockResult.catch === 'function') void lockResult.catch(() => undefined)
        } catch {
          // Pointer lock is optional; drag-to-look still works.
        }
      }
    }
    const onPointerUp = () => { this.pointerDown = false }
    const onPointerMove = (event: PointerEvent) => {
      if (this.paused) return
      if (this.pointerLocked && event.pointerType === 'mouse') {
        this.yaw -= event.movementX * 0.0025
        this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0018, -0.65, 0.25)
      } else if (this.pointerDown) {
        this.yaw -= (event.clientX - this.lastPointer.x) * 0.004
        this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - this.lastPointer.y) * 0.0025, -0.65, 0.25)
        this.lastPointer = { x: event.clientX, y: event.clientY }
      }
    }
    const onContext = (event: Event) => event.preventDefault()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerlockchange', onPointerLock)
    this.canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('pointermove', onPointerMove)
    this.canvas.addEventListener('contextmenu', onContext)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.canvas)
    this.cleanupEvents = () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerlockchange', onPointerLock)
      this.canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('pointermove', onPointerMove)
      this.canvas.removeEventListener('contextmenu', onContext)
    }
  }

  private cleanupEvents: (() => void) | null = null

  setTouchKey(key: string, down: boolean) {
    if (down) this.touchKeys.add(key)
    else this.touchKeys.delete(key)
    if (key === 'Space' && down && this.grounded && !this.paused) {
      this.verticalVelocity = 7.2
      this.grounded = false
    }
  }

  pause() {
    this.paused = true
    this.keys.clear()
    this.touchKeys.clear()
    this.pointerDown = false
    this.callbacks.onStatus('paused')
  }

  resume() {
    this.paused = false
    this.keys.clear()
    this.touchKeys.clear()
    this.callbacks.onStatus('ready')
    this.clock.getDelta()
    if (!this.raf && !this.destroyed) this.loop()
  }

  private resize() {
    if (!this.renderer) return
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.15 : 1.5))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private loop = () => {
    if (this.destroyed || !this.renderer) { this.raf = 0; return }
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.04)
    if (!this.paused) this.update(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private update(dt: number) {
    const forward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touchKeys.has('KeyW') ? 1 : 0)
      - (this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touchKeys.has('KeyS') ? 1 : 0)
    const sideways = (this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touchKeys.has('KeyD') ? 1 : 0)
      - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touchKeys.has('KeyA') ? 1 : 0)
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchKeys.has('ShiftLeft')
    const speed = sprint ? 10 : 5.4
    const input = new THREE.Vector3(sideways, 0, -forward)
    if (input.lengthSq() > 0) {
      input.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, input.x * speed, 10, dt)
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, input.z * speed, 10, dt)
      this.player.rotation.y = Math.atan2(this.velocity.x, this.velocity.z)
    } else {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, 9, dt)
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, 9, dt)
    }

    const nextX = this.player.position.x + this.velocity.x * dt
    const nextZ = this.player.position.z + this.velocity.z * dt
    if (!this.collides(nextX, this.player.position.z)) this.player.position.x = nextX
    else this.velocity.x = 0
    if (!this.collides(this.player.position.x, nextZ)) this.player.position.z = nextZ
    else this.velocity.z = 0

    this.verticalVelocity -= 19.5 * dt
    this.player.position.y += this.verticalVelocity * dt
    if (this.player.position.y <= 0) {
      this.player.position.y = 0
      this.verticalVelocity = 0
      this.grounded = true
    }

    const moving = Math.abs(forward) + Math.abs(sideways) > 0
    if (this.playerBody) this.playerBody.scale.y = moving ? 1 + Math.sin(performance.now() * 0.012) * 0.035 : 1
    if (this.playerHead) this.playerHead.position.y = 1.72 + (moving ? Math.sin(performance.now() * 0.012) * 0.025 : 0)

    const cameraDistance = 7.5
    const horizontal = Math.cos(this.pitch) * cameraDistance
    const desired = new THREE.Vector3(
      this.player.position.x + Math.sin(this.yaw) * horizontal,
      this.player.position.y + 3.0 - Math.sin(this.pitch) * cameraDistance,
      this.player.position.z + Math.cos(this.yaw) * horizontal,
    )
    this.camera.position.lerp(desired, 1 - Math.exp(-7 * dt))
    this.cameraTarget.set(this.player.position.x, this.player.position.y + 1.15, this.player.position.z)
    this.camera.lookAt(this.cameraTarget)

    const now = performance.now()
    if (now - this.lastSpeedEmit > 180) {
      this.callbacks.onSpeed(Math.hypot(this.velocity.x, this.velocity.z) * 3.6)
      this.lastSpeedEmit = now
    }
  }

  private collides(x: number, z: number) {
    if (Math.abs(x) > 600 || Math.abs(z) > 600) return true
    const radius = 0.55
    return this.obstacles.some(o =>
      x + radius > o.minX && x - radius < o.maxX &&
      z + radius > o.minZ && z - radius < o.maxZ,
    )
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver?.disconnect()
    this.cleanupEvents?.()
    if (document.pointerLockElement === this.canvas) void document.exitPointerLock()
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        if (Array.isArray(object.material)) object.material.forEach(m => m.dispose())
        else object.material.dispose()
      }
    })
    this.materials.forEach(m => m.dispose())
    this.renderer?.dispose()
    this.renderer = null
  }
}
