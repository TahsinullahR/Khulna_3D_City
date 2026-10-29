import * as THREE from 'three'
import { ModelStreamer } from './ModelStreamer'

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
type TrafficVehicleKind = 'auto-rickshaw' | 'cng' | 'easybike' | 'motorcycle' | 'bus' | 'truck'
type TrafficAgent = { root: THREE.Group; kind: TrafficVehicleKind; route: THREE.Vector3[]; routeId: number; previousRouteId: number | null; segment: number; progress: number; speed: number; cruiseSpeed: number; stopped: boolean }

// Spawn is anchored near the coordinates shown in the user's Khulna map reference.
const CENTER = { lat: 22.812758, lon: 89.540243 }
// Phase 3 prioritizes the Sonadanga / Khulna City Medical College / Banorgati side
// of central Khulna. This is a district-scale map, not the whole city.
const BBOX = { south: 22.793, west: 89.515, north: 22.833, east: 89.565 }
const MAP_CACHE_KEY = 'khulna-city-osm-v3'
const MAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const METERS_PER_LAT = 111_320
const METERS_PER_LON = 111_320 * Math.cos(CENTER.lat * Math.PI / 180)

export class KhulnaGame {
  private renderer: THREE.WebGLRenderer | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000)
  private player = new THREE.Group()
  private vehicle = new THREE.Group()
  private wheelRollers: THREE.Group[] = []
  private frontWheelPivots: THREE.Group[] = []
  private vehicleMode = false
  private vehicleSpeed = 0
  private vehicleSteer = 0
  private playerBody: THREE.Mesh | null = null
  private playerHead: THREE.Mesh | null = null
  private keys = new Set<string>()
  private touchKeys = new Set<string>()
  private obstacles: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = []
  private roadRoutes: THREE.Vector3[][] = []
  private traffic: TrafficAgent[] = []
  private trafficRoutes: THREE.Vector3[][] = []
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
  private modelStreamer: ModelStreamer | null = null

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
      this.callbacks.onMessage('Loading central Khulna roads, buildings, green areas and waterways…')
      const loaded = await this.loadOSM()
      if (this.destroyed) return
      if (loaded) {
        this.callbacks.onMapSource('osm')
        this.callbacks.onMessage('Mapped roads, buildings and available green/water features loaded.')
      } else {
        // An incomplete OSM response may have created a few meshes before validation failed.
        // Clear it before constructing the fallback so the scene never mixes partial datasets.
        this.clearMapGroup()
        this.buildFallbackDistrict()
        this.callbacks.onMapSource('fallback')
        this.callbacks.onMessage('Map service unavailable; using the local playable prototype.')
      }
      this.setupTraffic()
      this.modelStreamer = new ModelStreamer(this.scene)
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
    this.scene.fog = new THREE.Fog('#a9c3d0', 250, 2600)
    this.camera.position.set(0, 5, 10)

    const hemi = new THREE.HemisphereLight('#e8f4ff', '#77715d', 2.0)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff1d2', 2.6)
    sun.position.set(-120, 180, 90)
    this.scene.add(sun)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: '#777f70', roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.08
    ground.receiveShadow = true
    this.scene.add(ground)

    const horizon = new THREE.GridHelper(6000, 300, '#8d9689', '#828b80')
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
    this.setupVehicle()
    this.cameraTarget.set(0, 1.3, 0)
  }

  private setupVehicle() {
    const paint = new THREE.MeshStandardMaterial({ color: '#d84b35', metalness: 0.22, roughness: 0.42 })
    const glass = new THREE.MeshStandardMaterial({ color: '#233943', metalness: 0.18, roughness: 0.25 })
    const tire = new THREE.MeshStandardMaterial({ color: '#161b1d', roughness: 0.9 })
    const hub = new THREE.MeshStandardMaterial({ color: '#d8d6ca', metalness: 0.55, roughness: 0.3 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 3.5), paint)
    body.position.y = 0.72
    this.vehicle.add(body)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.72, 1.7), glass)
    cabin.position.set(0, 1.28, -0.12)
    this.vehicle.add(cabin)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.2, 0.72), paint)
    hood.position.set(0, 0.98, -1.27)
    this.vehicle.add(hood)
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.16, 0.14), hub)
    bumper.position.set(0, 0.49, -1.78)
    this.vehicle.add(bumper)
    // Distinctive grille, headlamps, rear lamps and side accent make the player car
    // read as a designed vehicle instead of a plain collection of boxes.
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.035), new THREE.MeshStandardMaterial({ color: '#252c30', roughness: 0.55 }))
    grille.position.set(0, 0.68, -1.77)
    this.vehicle.add(grille)
    const headlamp = new THREE.MeshStandardMaterial({ color: '#fff0b5', emissive: '#8b6425', emissiveIntensity: 0.25 })
    const tailLamp = new THREE.MeshStandardMaterial({ color: '#d92f2f', emissive: '#7a1010', emissiveIntensity: 0.2 })
    for (const x of [-0.62, 0.62]) {
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.045), headlamp)
      front.position.set(x, 0.83, -1.77)
      this.vehicle.add(front)
      const rear = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.045), tailLamp)
      rear.position.set(x, 0.78, 1.77)
      this.vehicle.add(rear)
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 2.2), hub)
      stripe.position.set(x < 0 ? -0.906 : 0.906, 0.76, 0.05)
      this.vehicle.add(stripe)
    }
    for (const x of [-0.94, 0.94]) {
      for (const z of [-1.12, 1.12]) {
        const pivot = new THREE.Group()
        pivot.position.set(x, 0.39, z)
        const assembly = new THREE.Group()
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 12), tire)
        wheel.rotation.z = Math.PI / 2
        assembly.add(wheel)
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.19, 10), hub)
        rim.rotation.z = Math.PI / 2
        assembly.add(rim)
        pivot.add(assembly)
        this.vehicle.add(pivot)
        this.wheelRollers.push(assembly)
        if (z < 0) this.frontWheelPivots.push(pivot)
      }
    }
    for (const x of [-0.56, 0.56]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.07), new THREE.MeshBasicMaterial({ color: '#fff1b8' }))
      light.position.set(x, 0.78, -1.79)
      this.vehicle.add(light)
    }
    this.vehicle.position.set(3.8, 0, 0)
    this.scene.add(this.vehicle)
  }

  private setVehicleMode(enable: boolean) {
    if (this.vehicleMode === enable) return
    if (enable) {
      const gap = this.vehicle.position.distanceTo(this.player.position)
      if (gap > 6) {
        this.callbacks.onMessage('Walk closer to the parked car to drive it (press V).')
        return
      }
      this.player.position.copy(this.vehicle.position)
      this.player.visible = false
      this.vehicle.visible = true
      this.vehicleMode = true
      this.callbacks.onMessage('Driving mode: W/S accelerate or reverse, A/D steer. Press V to exit.')
    } else {
      const exitPoint = this.vehicle.position.clone().add(new THREE.Vector3(2.2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicle.rotation.y))
      if (!this.collides(exitPoint.x, exitPoint.z)) this.player.position.copy(exitPoint)
      this.player.visible = true
      this.vehicleMode = false
      this.vehicleSpeed = 0
      this.vehicleSteer = 0
      this.frontWheelPivots.forEach(pivot => { pivot.rotation.y = 0 })
      this.callbacks.onMessage('On foot: WASD move, Shift sprint, Space jump. Press V near the car to drive.')
    }
  }

  private localPosition(lat: number, lon: number) {
    return {
      x: (lon - CENTER.lon) * METERS_PER_LON,
      z: -(lat - CENTER.lat) * METERS_PER_LAT,
    }
  }

  private async loadOSM(): Promise<boolean> {
    // Cache the validated map data locally so repeat visits do not repeatedly
    // hit public Overpass servers. Storage can be unavailable or full, so it is optional.
    try {
      const raw = window.localStorage.getItem(MAP_CACHE_KEY)
      if (raw) {
        const cached = JSON.parse(raw) as { savedAt: number; data: OSMResponse }
        if (Date.now() - cached.savedAt < MAP_CACHE_TTL_MS &&
            Array.isArray(cached.data?.elements) && cached.data.elements.length >= 5) {
          try {
            this.renderOSM(cached.data.elements)
            this.callbacks.onMessage('Loaded the locally cached Khulna map data.')
            return true
          } catch (error) {
            console.warn('Cached map data was invalid; fetching a fresh copy.', error)
            this.clearMapGroup()
            window.localStorage.removeItem(MAP_CACHE_KEY)
          }
        }
      }
    } catch (error) {
      console.warn('Local map cache is unavailable; continuing without it.', error)
    }

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
          try {
            window.localStorage.setItem(MAP_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }))
          } catch (cacheError) {
            console.info('Map loaded but could not be cached in this browser.', cacheError)
          }
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
    const buildingPalette = ['#e7c9a0', '#d8b69a', '#b7c8c3', '#e0d5bd', '#d9a9a0', '#b6c7dc', '#d8c68f', '#c6b4d9', '#d5d0c4', '#a9c6ae']
    let buildingIndex = 0
    let roadCount = 0
    let buildingCount = 0
    let landmarkCount = 0
    const windowInstances: THREE.Matrix4[] = []
    const windowGeometry = new THREE.BoxGeometry(0.72, 0.82, 0.055)
    const windowMaterial = new THREE.MeshStandardMaterial({ color: '#243f4b', roughness: 0.34, metalness: 0.12 })
    this.materials.push(windowMaterial)

    for (const element of elements) {
      const points = element.geometry
      if (!points || points.length < 2) continue
      const coords = points.map(p => this.localPosition(p.lat, p.lon))
      const tags = element.tags ?? {}
      const label = tags['name:en'] || tags.name || ''
      const isLandmark = Boolean(label && (
        tags.amenity || tags.shop || tags.tourism || tags.leisure === 'park' ||
        tags.historic || tags.healthcare || tags.building === 'hospital' ||
        tags.building === 'school' || tags.building === 'university'
      ))

      if (tags.highway || tags.waterway) {
        const highway = tags.highway || ''
        if (tags.highway && coords.length >= 3 && ['primary','secondary','tertiary','residential','unclassified'].includes(highway)) {
          const route = coords.map(point => new THREE.Vector3(point.x, 0, point.z))
          const routeLength = route.slice(1).reduce((sum, point, i) => sum + point.distanceTo(route[i]), 0)
          if (routeLength > 160 && route.every(point => Number.isFinite(point.x) && Number.isFinite(point.z))) this.roadRoutes.push(route)
        }
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
        const height = Math.max(3.2, Math.min(75, heightTag || (levels > 0 ? levels * 3.1 : tags.building === 'apartments' || tags.building === 'commercial' ? 12 : 6 + (buildingIndex % 5) * 1.7)))
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

        // Add a restrained, low-cost window grid to compact buildings. Instances share
        // one geometry/material so facade detail does not create a mesh per window.
        const minX = Math.min(...distinct.map(p => p.x)), maxX = Math.max(...distinct.map(p => p.x))
        const minZ = Math.min(...distinct.map(p => p.z)), maxZ = Math.max(...distinct.map(p => p.z))
        const facadeWidth = maxX - minX
        if (facadeWidth > 5 && facadeWidth < 38 && maxZ - minZ < 45 && height >= 5.5) {
          const columns = Math.max(1, Math.min(6, Math.floor(facadeWidth / 3.2)))
          const floors = Math.max(1, Math.min(12, Math.floor(height / 3.1)))
          for (let floor = 0; floor < floors; floor++) {
            for (let col = 0; col < columns; col++) {
              const x = minX + (col + 1) * facadeWidth / (columns + 1)
              const y = 1.45 + floor * 3.05
              const matrix = new THREE.Matrix4().makeTranslation(x, y, minZ - 0.045)
              windowInstances.push(matrix)
            }
          }
        }
        if (isLandmark) {
          const centerX = distinct.reduce((sum, p) => sum + p.x, 0) / distinct.length
          const centerZ = distinct.reduce((sum, p) => sum + p.z, 0) / distinct.length
          this.addLandmarkLabel(label, centerX, centerZ, height + 2)
          landmarkCount++
        }

        const xs = distinct.map(p => p.x), zs = distinct.map(p => p.z)
        this.obstacles.push({
          minX: Math.min(...xs) - 0.35, maxX: Math.max(...xs) + 0.35,
          minZ: Math.min(...zs) - 0.35, maxZ: Math.max(...zs) + 0.35,
        })
        buildingIndex++
        buildingCount++
      }
    }

    if (windowInstances.length) {
      const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, windowInstances.length)
      windowInstances.forEach((matrix, index) => windows.setMatrixAt(index, matrix))
      windows.instanceMatrix.needsUpdate = true
      windows.frustumCulled = true
      this.mapGroup.add(windows)
    }

    // Source center is the initial spawn, with a small safety area around the player.
    this.obstacles = this.obstacles.filter(o => !(o.minX < 1.2 && o.maxX > -1.2 && o.minZ < 1.2 && o.maxZ > -1.2))
    console.info(`Khulna OSM district loaded: ${roadCount} road segments, ${buildingCount} building footprints, ${landmarkCount} named landmarks.`)
    if (roadCount < 3 || buildingCount < 3) throw new Error('The returned map data was too small.')
  }

  private addLandmarkLabel(label: string, x: number, z: number, y: number) {
    // Canvas-backed labels avoid external font/image dependencies and keep landmarks readable.
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return
    const fontSize = 44
    context.font = `600 ${fontSize}px system-ui, sans-serif`
    const textWidth = Math.ceil(context.measureText(label).width)
    canvas.width = Math.min(1024, Math.max(256, textWidth + 48))
    canvas.height = 88
    context.font = `600 ${fontSize}px system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineWidth = 8
    context.strokeStyle = 'rgba(14, 22, 25, 0.9)'
    context.fillStyle = '#f7f7f0'
    context.strokeText(label, canvas.width / 2, canvas.height / 2)
    context.fillText(label, canvas.width / 2, canvas.height / 2)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(material)
    sprite.position.set(x, Math.min(y, 85), z)
    sprite.scale.set(Math.max(8, Math.min(28, label.length * 0.65)), Math.max(2.4, Math.min(5.5, label.length * 0.13)), 1)
    sprite.renderOrder = 5
    sprite.userData.landmarkLabel = label
    this.mapGroup.add(sprite)
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
    // Use long fallback avenues as traffic routes when live map data is unavailable.
    for (const z of [-90, -60, -30, 0, 30, 60, 90]) {
      this.roadRoutes.push([new THREE.Vector3(-105, 0, z), new THREE.Vector3(105, 0, z)])
    }
    for (const x of [-90, -60, -30, 0, 30, 60, 90]) {
      this.roadRoutes.push([new THREE.Vector3(x, 0, -105), new THREE.Vector3(x, 0, 105)])
    }
  }

  private createTrafficVehicle(kind: TrafficVehicleKind, color: string): THREE.Group {
    const root = new THREE.Group()
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.08 })
    const dark = new THREE.MeshStandardMaterial({ color: '#20272a', roughness: 0.82 })
    const glass = new THREE.MeshStandardMaterial({ color: '#243c49', roughness: 0.3, metalness: 0.08 })
    const trim = new THREE.MeshStandardMaterial({ color: '#d8d7c9', roughness: 0.5 })
    const addBox = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
      mesh.position.set(x, y, z)
      root.add(mesh)
      return mesh
    }
    const addWheel = (x: number, z: number, radius = 0.28) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.16, 10), dark)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, radius, z)
      root.add(wheel)
    }

    if (kind === 'motorcycle') {
      addWheel(0, 0.92, 0.29); addWheel(0, -0.88, 0.29)
      addBox(0.32, 0.34, 0.95, paint, 0, 0.72, 0)
      addBox(0.38, 0.16, 0.4, dark, 0, 0.94, -0.12)
      addBox(0.08, 0.3, 0.08, trim, 0, 1.04, 0.53)
      addBox(0.48, 0.1, 0.1, dark, 0, 1.15, 0.48)
      // Simple rider silhouette makes the two-wheeler readable at game distance.
      const rider = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), trim)
      rider.position.set(0, 1.25, -0.08); root.add(rider)
      addBox(0.34, 0.36, 0.3, dark, 0, 0.98, -0.08)
    } else if (kind === 'auto-rickshaw') {
      addWheel(-0.53, 0.88); addWheel(0.53, 0.88); addWheel(0, -0.9)
      addBox(1.05, 0.48, 1.8, paint, 0, 0.58, 0)
      addBox(0.92, 0.5, 0.75, glass, 0, 1.05, 0.48)
      addBox(1.12, 0.12, 1.15, paint, 0, 1.37, -0.08)
      addBox(0.08, 0.45, 0.08, dark, -0.46, 0.95, -0.1)
      addBox(0.08, 0.45, 0.08, dark, 0.46, 0.95, -0.1)
    } else if (kind === 'cng') {
      addWheel(-0.55, 0.88); addWheel(0.55, 0.88); addWheel(0, -0.9)
      addBox(1.12, 0.5, 1.9, paint, 0, 0.58, 0)
      addBox(1.0, 0.55, 0.82, glass, 0, 1.1, 0.42)
      addBox(1.18, 0.13, 1.2, paint, 0, 1.44, -0.08)
      addBox(0.08, 0.42, 0.08, dark, -0.5, 0.96, -0.12)
      addBox(0.08, 0.42, 0.08, dark, 0.5, 0.96, -0.12)
      addBox(0.9, 0.12, 0.08, trim, 0, 0.62, 0.98)
    } else if (kind === 'easybike') {
      addWheel(-0.58, 0.92); addWheel(0.58, 0.92); addWheel(0, -0.92)
      addBox(1.18, 0.35, 1.65, paint, 0, 0.5, 0)
      addBox(1.15, 0.12, 1.55, trim, 0, 0.75, -0.02)
      addBox(1.25, 0.12, 1.45, paint, 0, 1.22, -0.02)
      addBox(0.08, 0.48, 0.08, dark, -0.52, 0.97, -0.58)
      addBox(0.08, 0.48, 0.08, dark, 0.52, 0.97, -0.58)
      addBox(1.05, 0.08, 0.08, dark, 0, 0.99, -0.58)
      addBox(0.86, 0.42, 0.72, glass, 0, 0.91, 0.4)
    } else if (kind === 'bus') {
      addWheel(-0.68, 1.85, 0.34); addWheel(0.68, 1.85, 0.34)
      addWheel(-0.68, -1.75, 0.34); addWheel(0.68, -1.75, 0.34)
      addBox(1.72, 1.35, 4.7, paint, 0, 1.0, 0)
      addBox(1.58, 0.58, 3.65, glass, 0, 1.48, -0.12)
      addBox(1.74, 0.14, 0.65, paint, 0, 0.84, 2.0)
      addBox(1.55, 0.12, 0.12, trim, 0, 0.48, 2.38)
    } else if (kind === 'truck') {
      addWheel(-0.66, 1.55, 0.34); addWheel(0.66, 1.55, 0.34)
      addWheel(-0.66, -1.7, 0.34); addWheel(0.66, -1.7, 0.34)
      addBox(1.65, 1.0, 1.35, paint, 0, 0.95, 1.05)
      addBox(1.35, 0.58, 0.7, glass, 0, 1.35, 1.35)
      addBox(1.7, 1.35, 2.6, trim, 0, 1.12, -0.95)
      addBox(1.75, 0.12, 2.7, paint, 0, 1.82, -0.95)
    }
    return root
  }

  private setupTraffic() {
    // Join road-way fragments whose endpoints meet closely. Reverse a fragment when
    // its far endpoint is the matching end; this creates longer continuous paths
    // without teleporting vehicles between unrelated roads.
    const fragments = this.roadRoutes.filter(route => route.length >= 2).map(route => route.map(p => p.clone()))
    const routes: THREE.Vector3[][] = []
    while (fragments.length) {
      const chain = fragments.shift()!
      let joined = true
      while (joined) {
        joined = false
        const tail = chain[chain.length - 1]
        let bestIndex = -1
        let reverse = false
        let bestDistance = 12
        for (let i = 0; i < fragments.length; i++) {
          const candidate = fragments[i]
          const startDistance = tail.distanceTo(candidate[0])
          const endDistance = tail.distanceTo(candidate[candidate.length - 1])
          if (startDistance < bestDistance) {
            bestDistance = startDistance
            bestIndex = i
            reverse = false
          }
          if (endDistance < bestDistance) {
            bestDistance = endDistance
            bestIndex = i
            reverse = true
          }
        }
        if (bestIndex >= 0) {
          const next = fragments.splice(bestIndex, 1)[0]
          if (reverse) next.reverse()
          // Snap the new fragment's first point to the existing endpoint to avoid
          // tiny gaps and keep position interpolation continuous.
          next[0].copy(tail)
          chain.push(...next.slice(1))
          joined = true
        }
      }
      if (chain.length >= 2) routes.push(chain)
    }
    if (!routes.length) return
    this.trafficRoutes = routes
    const count = Math.min(10, routes.length)
    const kinds: TrafficVehicleKind[] = ['auto-rickshaw', 'cng', 'easybike', 'motorcycle', 'bus', 'truck']
    const colors = ['#f2c230', '#008f54', '#ef633d', '#23272b', '#1679bd', '#e8e8df', '#d83c32', '#f1eee4', '#2d8f9b', '#a4b1c0']
    for (let i = 0; i < count; i++) {
      const route = routes[i]
      const kind = kinds[i % kinds.length]
      const root = this.createTrafficVehicle(kind, colors[i % colors.length])
      const routeLength = route.slice(1).reduce((sum, point, index) => sum + point.distanceTo(route[index]), 0)
      const segment = Math.max(0, Math.min(route.length - 2, Math.floor(i * (route.length - 1) / count)))
      const start = route[segment].clone()
      root.position.copy(start)
      this.scene.add(root)
      const cruiseSpeed = kind === 'motorcycle' ? 5.2 : kind === 'bus' || kind === 'truck' ? 3.0 : kind === 'easybike' ? 2.5 : 3.6
      this.traffic.push({ root, kind, route, routeId: i, previousRouteId: null, segment, progress: 0, speed: cruiseSpeed, cruiseSpeed, stopped: false })
      // Route data can include dense OSM vertices. Each agent advances segment by segment.
      void routeLength
    }
  }

  private chooseNextTrafficRoute(agent: TrafficAgent): { route: THREE.Vector3[]; routeId: number } | null {
    const end = agent.route[agent.route.length - 1]
    const previous = agent.route[agent.route.length - 2]
    if (!end || !previous) return null
    const incoming = end.clone().sub(previous).normalize()
    let best: { route: THREE.Vector3[]; routeId: number; score: number } | null = null

    // Phase 13: look for a nearby route endpoint and prefer the continuation
    // that changes heading least. This is endpoint-based routing, not a full
    // intersection graph; crossings in the middle of OSM ways are not nodes.
    for (let i = 0; i < this.trafficRoutes.length; i++) {
      if (i === agent.routeId) continue
      const candidate = this.trafficRoutes[i]
      if (candidate.length < 2) continue
      const first = candidate[0]
      const last = candidate[candidate.length - 1]
      const firstGap = end.distanceTo(first)
      const lastGap = end.distanceTo(last)
      const gap = Math.min(firstGap, lastGap)
      if (gap > 12) continue

      const reverse = lastGap < firstGap
      const oriented = reverse ? [...candidate].reverse() : candidate
      const outgoing = oriented[1].clone().sub(oriented[0]).normalize()
      const alignment = THREE.MathUtils.clamp(incoming.dot(outgoing), -1, 1)
      // Strongly prefer continuity, but allow a turn when no straight option exists.
      const backtrackPenalty = i === agent.previousRouteId ? 8 : 0
      const score = gap + (1 - alignment) * 3 + backtrackPenalty
      if (!best || score < best.score) best = { route: oriented.map(point => point.clone()), routeId: i, score }
    }
    if (!best) return null
    // Snap only the joining endpoint so the vehicle does not jump across a small gap.
    best.route[0].copy(end)
    return { route: best.route, routeId: best.routeId }
  }

  private updateTraffic(dt: number) {
    // Small fixed agent cap keeps collision checks predictable on mobile.
    const playerPosition = this.vehicleMode ? this.vehicle.position : this.player.position
    for (const agent of this.traffic) {
      if (agent.stopped) continue

      // Phase 10: soft braking for the player vehicle/character and nearby traffic.
      // This is proximity-based, not a physical rigid-body collision system.
      let targetSpeed = agent.cruiseSpeed
      const playerGap = agent.root.position.distanceTo(playerPosition)
      if (playerGap < 6.5) {
        targetSpeed = Math.min(targetSpeed, THREE.MathUtils.clamp((playerGap - 2.2) * 1.25, 0, agent.cruiseSpeed))
      }
      // Phase 12: only brake for traffic that is ahead and approximately in the
      // same corridor. This avoids reacting equally to cars beside or behind us.
      // Stopped agents remain obstacles so following traffic can slow before them.
      const currentFrom = agent.route[agent.segment]
      const currentTo = agent.route[agent.segment + 1]
      if (currentFrom && currentTo) {
        const forward = currentTo.clone().sub(currentFrom).normalize()
        for (const other of this.traffic) {
          if (other === agent) continue
          const relative = other.root.position.clone().sub(agent.root.position)
          const forwardGap = relative.dot(forward)
          if (forwardGap <= 0 || forwardGap >= 8.5) continue
          const lateralSq = Math.max(0, relative.lengthSq() - forwardGap * forwardGap)
          if (lateralSq > 2.8 * 2.8) continue
          const safeGap = other.stopped ? 2.6 : 2.2
          const followingSpeed = THREE.MathUtils.clamp((forwardGap - safeGap) * 1.1, 0, agent.cruiseSpeed)
          targetSpeed = Math.min(targetSpeed, followingSpeed)
        }
      }

      // Phase 11: anticipate sharp route bends and slow before reaching the corner.
      // This is junction-approach caution, not map-topology-aware turn planning.
      const from = agent.route[agent.segment]
      const to = agent.route[agent.segment + 1]
      const next = agent.route[agent.segment + 2]
      if (from && to && next) {
        const segmentLength = from.distanceTo(to)
        const remainingToCorner = Math.max(0, segmentLength - agent.progress)
        const incoming = to.clone().sub(from).normalize()
        const outgoing = next.clone().sub(to).normalize()
        const turnAngle = Math.acos(THREE.MathUtils.clamp(incoming.dot(outgoing), -1, 1))
        if (turnAngle > 0.42 && remainingToCorner < 12) {
          const cornerSpeed = THREE.MathUtils.clamp(1.2 + remainingToCorner * 0.45, 1.2, agent.cruiseSpeed)
          targetSpeed = Math.min(targetSpeed, cornerSpeed)
        }
      }

      const response = targetSpeed < agent.speed ? 4.5 : 0.85
      agent.speed = THREE.MathUtils.damp(agent.speed, targetSpeed, response, dt)

      let remaining = agent.speed * dt
      let safety = 0
      while (remaining > 0 && safety++ < 20) {
        const from = agent.route[agent.segment]
        const to = agent.route[agent.segment + 1]
        // Open route ends remain terminal; vehicles never teleport to route start.
        if (!from || !to) {
          agent.stopped = true
          break
        }
        const distance = from.distanceTo(to)
        if (distance < 0.1) {
          agent.segment++
          agent.progress = 0
          if (agent.segment >= agent.route.length - 1) {
            const nextRoute = this.chooseNextTrafficRoute(agent)
            if (nextRoute) {
              agent.previousRouteId = agent.routeId
              agent.route = nextRoute.route
              agent.routeId = nextRoute.routeId
              agent.segment = 0
              agent.progress = 0
              agent.root.position.copy(agent.route[0])
            } else agent.stopped = true
          }
          continue
        }
        const available = distance - agent.progress
        const travel = Math.min(remaining, available)
        agent.progress += travel
        remaining -= travel
        const t = THREE.MathUtils.clamp(agent.progress / distance, 0, 1)
        agent.root.position.lerpVectors(from, to, t)
        const direction = to.clone().sub(from)
        agent.root.rotation.y = Math.atan2(-direction.x, -direction.z)
        if (agent.progress >= distance - 0.001) {
          agent.segment++
          agent.progress = 0
          if (agent.segment >= agent.route.length - 1) {
            const nextRoute = this.chooseNextTrafficRoute(agent)
            if (nextRoute) {
              agent.route = nextRoute.route
              agent.routeId = nextRoute.routeId
              agent.segment = 0
              agent.progress = 0
              agent.root.position.copy(agent.route[0])
            } else agent.stopped = true
          }
        }
      }
      // Keep agents visible when nearby so braking feels connected to the world.
      agent.root.visible = !agent.stopped
    }
  }

  private installEvents() {
    const onKeyDown = (event: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
      if (event.code === 'KeyV' && !event.repeat && !this.paused) this.setVehicleMode(!this.vehicleMode)
      this.keys.add(event.code)
      if (event.code === 'Escape') {
        if (this.pointerLocked) void document.exitPointerLock()
        this.pause()
      }
      if (event.code === 'Space' && this.grounded && !this.paused && !this.vehicleMode) {
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
    if (key === 'KeyV' && down && !this.paused) { this.setVehicleMode(!this.vehicleMode); return }
    if (down) this.touchKeys.add(key)
    else this.touchKeys.delete(key)
    if (key === 'Space' && down && this.grounded && !this.paused && !this.vehicleMode) {
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
    this.modelStreamer?.update(this.vehicleMode ? this.vehicle.position : this.player.position)
    this.updateTraffic(dt)
    const forward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touchKeys.has('KeyW') ? 1 : 0)
      - (this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touchKeys.has('KeyS') ? 1 : 0)
    const sideways = (this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touchKeys.has('KeyD') ? 1 : 0)
      - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touchKeys.has('KeyA') ? 1 : 0)
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchKeys.has('ShiftLeft')
    const speed = sprint ? 10 : 5.4
    if (this.vehicleMode) {
      const throttle = forward
      const braking = this.keys.has('Space') || this.touchKeys.has('Space')
      if (braking) {
        this.vehicleSpeed = THREE.MathUtils.damp(this.vehicleSpeed, 0, 7.5, dt)
      } else {
        this.vehicleSpeed += throttle * (this.vehicleSpeed < 0 && throttle > 0 ? 19 : this.vehicleSpeed > 0 && throttle < 0 ? 18 : 11) * dt
        if (throttle === 0) this.vehicleSpeed = THREE.MathUtils.damp(this.vehicleSpeed, 0, 1.7, dt)
      }
      this.vehicleSpeed = THREE.MathUtils.clamp(this.vehicleSpeed, -7, 23)
      const steer = sideways
      const steerScale = Math.min(1, Math.abs(this.vehicleSpeed) / 3)
      this.vehicleSteer = THREE.MathUtils.damp(this.vehicleSteer, steer * 0.42 * steerScale, 8, dt)
      this.frontWheelPivots.forEach(pivot => { pivot.rotation.y = -this.vehicleSteer })
      const proposedYaw = this.vehicle.rotation.y - steer * steerScale * dt * (this.vehicleSpeed >= 0 ? 1.35 : -1.35)
      const carDirection = new THREE.Vector3(Math.sin(proposedYaw), 0, -Math.cos(proposedYaw))
      const next = this.vehicle.position.clone().addScaledVector(carDirection, this.vehicleSpeed * dt)
      // Approximate the car footprint with oriented corner and side samples.
      // This remains arcade collision, but reduces clipping through mapped buildings.
      const forwardAxis = carDirection
      const rightAxis = new THREE.Vector3(Math.cos(proposedYaw), 0, Math.sin(proposedYaw))
      const testPoints = [
        next.clone().addScaledVector(forwardAxis, 1.65).addScaledVector(rightAxis, 0.9),
        next.clone().addScaledVector(forwardAxis, 1.65).addScaledVector(rightAxis, -0.9),
        next.clone().addScaledVector(forwardAxis, -1.65).addScaledVector(rightAxis, 0.9),
        next.clone().addScaledVector(forwardAxis, -1.65).addScaledVector(rightAxis, -0.9),
        next.clone().addScaledVector(forwardAxis, 1.65),
        next.clone().addScaledVector(forwardAxis, -1.65),
        next.clone().addScaledVector(rightAxis, 0.9),
        next.clone().addScaledVector(rightAxis, -0.9),
      ]
      if (testPoints.every(point => !this.collides(point.x, point.z))) {
        this.vehicle.position.x = next.x
        this.vehicle.position.z = next.z
        this.vehicle.rotation.y = proposedYaw
      } else {
        this.vehicleSpeed = THREE.MathUtils.damp(this.vehicleSpeed, 0, 14, dt)
      }
      const wheelSpin = this.vehicleSpeed * dt / 0.34
      this.wheelRollers.forEach(roller => { roller.rotation.x += wheelSpin })
      this.player.position.copy(this.vehicle.position)
      this.player.rotation.y = this.vehicle.rotation.y
      this.velocity.set(carDirection.x * this.vehicleSpeed, 0, carDirection.z * this.vehicleSpeed)
      const followDistance = 8.5 + Math.min(3.5, Math.abs(this.vehicleSpeed) * 0.12)
      const carCamera = new THREE.Vector3(
        this.vehicle.position.x - Math.sin(this.vehicle.rotation.y) * followDistance,
        this.vehicle.position.y + 3.6 + Math.min(1.2, Math.abs(this.vehicleSpeed) * 0.04),
        this.vehicle.position.z + Math.cos(this.vehicle.rotation.y) * followDistance,
      )
      this.camera.position.lerp(carCamera, 1 - Math.exp(-4.5 * dt))
      this.cameraTarget.set(this.vehicle.position.x, 1.15, this.vehicle.position.z)
      this.camera.lookAt(this.cameraTarget)
      const now = performance.now()
      if (now - this.lastSpeedEmit > 180) {
        this.callbacks.onSpeed(Math.abs(this.vehicleSpeed) * 3.6)
        this.lastSpeedEmit = now
      }
      return
    }
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
    if (Math.abs(x) > 2800 || Math.abs(z) > 2300) return true
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
    this.modelStreamer?.dispose()
    this.modelStreamer = null
    this.traffic = []
    this.roadRoutes = []
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
