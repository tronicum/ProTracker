import css from "./VisualizerWebGL.sass?inline"
import {DefaultObservableValue, isDefined, Lifecycle, Terminable} from "@opendaw/lib-std"
import {createElement, Inject} from "@opendaw/lib-jsx"
import {AnimationFrame, Html} from "@opendaw/lib-dom"
import {Player} from "@/Player"
import {AudioState, sampleBands} from "@/ui/audioReactive"
import * as THREE from "three"
import {EffectComposer} from "three/addons/postprocessing/EffectComposer.js"
import {RenderPass} from "three/addons/postprocessing/RenderPass.js"
import {UnrealBloomPass} from "three/addons/postprocessing/UnrealBloomPass.js"
import {OutputPass} from "three/addons/postprocessing/OutputPass.js"
import {OrbitControls} from "three/addons/controls/OrbitControls.js"
import {ParametricGeometry} from "three/addons/geometries/ParametricGeometry.js"
import {mobius} from "three/addons/geometries/ParametricFunctions.js"

const className = Html.adoptStyleSheet(css, "VisualizerWebGL")

// A square grid of bars read radially outward from the center, like a classic
// tracker/Winamp-era spectrum analyzer bent into a floor instead of a single row.
const GRID_SIZE = 14
const BAR_COUNT = GRID_SIZE * GRID_SIZE
const BAR_SPACING = 0.5
const STAR_COUNT = 900

type Construct = {
    lifecycle: Lifecycle
    player: Player
}

const dummy = new THREE.Object3D()
const barColor = new THREE.Color()

type CoreShape = "icosahedron" | "torusKnot" | "octahedron" | "dodecahedron" | "tetrahedron" | "mobius"

type Preset = {
    name: string
    shape: CoreShape
    hueBase: number   // 0-1, center of the palette
    hueSpread: number // how much of the wheel the grid/stars sweep across
    hueSpeed: number  // how fast the sweep drifts over time
    tint: number      // multiplies the floor grid + starfield's baked-in vertex colors
    planets?: boolean // swap the wireframe core (and the bar grid) for a little orbiting solar system
    vga?: boolean     // swap everything for the VGA tribute screen, floating as a real plane in the scene
}

// Structurally distinct "themes" (shape/layout), each with its own color "variant" on top
// (hueBase/hueSpread/hueSpeed/tint) - cheap to add more of either without rebuilding anything.
const PRESETS: ReadonlyArray<Preset> = [
    {name: "Spectrum Grid", shape: "icosahedron", hueBase: 0.5, hueSpread: 1, hueSpeed: 0.015, tint: 0xffffff},
    {name: "Tunnel Knot", shape: "torusKnot", hueBase: 0.78, hueSpread: 0.25, hueSpeed: 0.02, tint: 0xdd88ff},
    {name: "Octa Pulse", shape: "octahedron", hueBase: 0.1, hueSpread: 0.35, hueSpeed: 0.01, tint: 0xffcc66},
    {name: "Dodeca Dream", shape: "dodecahedron", hueBase: 0.52, hueSpread: 0.3, hueSpeed: 0.008, tint: 0x66ccff},
    {name: "Phosphor Mono", shape: "icosahedron", hueBase: 0.33, hueSpread: 0.04, hueSpeed: 0.002, tint: 0x55ff88},
    {name: "Sunset Bars", shape: "tetrahedron", hueBase: 0.02, hueSpread: 0.15, hueSpeed: 0.012, tint: 0xff8855},
    {name: "Deep Space", shape: "torusKnot", hueBase: 0.63, hueSpread: 0.2, hueSpeed: 0.006, tint: 0x3355ff},
    {name: "Neon Grid", shape: "octahedron", hueBase: 0.5, hueSpread: 1, hueSpeed: 0.05, tint: 0xffffff},
    {name: "Mono Cyan", shape: "icosahedron", hueBase: 0.5, hueSpread: 0.02, hueSpeed: 0.004, tint: 0x33ffee},
    {name: "Candy", shape: "dodecahedron", hueBase: 0.85, hueSpread: 0.6, hueSpeed: 0.03, tint: 0xff99dd},
    {name: "Möbius Loop", shape: "mobius", hueBase: 0.72, hueSpread: 0.4, hueSpeed: 0.015, tint: 0xffffff},
    {name: "Orbital System", shape: "icosahedron", hueBase: 0.58, hueSpread: 0.5, hueSpeed: 0.01, tint: 0xffffff, planets: true},
    {name: "VGA Tribute", shape: "icosahedron", hueBase: 0.5, hueSpread: 1, hueSpeed: 0.01, tint: 0xffffff, vga: true}
]

const PLANET_COUNT = 6

// ---- VGA tribute screen: a tiny 320x200 framebuffer, drawn with a real canvas 2D context and
// mapped as a texture onto an actual plane inside the 3D scene (not a flat DOM overlay) - so it
// sits among the stars/floor grid like a floating monitor, and can tumble in 3D (see the "balloon"
// easter egg below) without needing any special-cased rendering path.
const FB_WIDTH = 320
const FB_HEIGHT = 200

const VGA_PALETTE = [
    "#000000", "#0000AA", "#00AA00", "#00AAAA",
    "#AA0000", "#AA00AA", "#AA5500", "#AAAAAA",
    "#555555", "#5555FF", "#55FF55", "#55FFFF",
    "#FF5555", "#FF55FF", "#FFFF55", "#FFFFFF"
] as const

const VGA_BOUNCE_COLORS = [9, 10, 11, 12, 13, 14, 15, 3, 2]

// Entirely original wording - a lighthearted nod to VGA-Copy, a real 1990s MS-DOS floppy-disk
// utility by Thomas Mönkemeier known for its VGA-mode interface, not a reproduction of its actual
// screens/code. No demoscene group names, logos, or real scrolltext are referenced or paraphrased.
const VGA_SCROLLTEXT =
    "   WELCOME TO THE PROTRACKER+ 4.2B VGA TRIBUTE SCREEN ...   " +
    "A SMALL ORIGINAL HOMAGE TO THE EARLY-1990S MS-DOS ERA, " +
    "AND ESPECIALLY TO VGA-COPY, THOMAS MOENKEMEIER'S BELOVED FLOPPY-DISK UTILITY " +
    "THAT TAUGHT A GENERATION WHAT A VGA SCREEN COULD LOOK LIKE ...   " +
    "BIG RESPECT TO EVERY CODER, COMPOSER AND SYSOP FROM THAT ERA ...   " +
    "LONG LIVE THE FLOPPY DISK, THE TRACKER AND THE SCENE ...   " +
    "THANKS FOR LISTENING ON PROTRACKER+ - NOW GO MAKE SOME NOISE ...   "

type VgaBounce = {x: number, y: number, vx: number, vy: number, colorIndex: number, pulse: number}

const drawVgaDiamond = (ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string): void => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(cx, cy - radius)
    ctx.lineTo(cx + radius, cy)
    ctx.lineTo(cx, cy + radius)
    ctx.lineTo(cx - radius, cy)
    ctx.closePath()
    ctx.fill()
}

const formatElapsed = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.min(99, Math.floor(totalSeconds / 60))
    const seconds = totalSeconds % 60
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

export const VisualizerWebGL = ({lifecycle, player}: Construct) => {
    const canvasHost: HTMLDivElement = <div className="canvas-host"/>
    const title = Inject.value("PROTRACKER+ 4.2B // WEBGL VIEW")
    const stateLine = Inject.value("STANDBY")
    const statusLine = Inject.value("")
    const hud: HTMLDivElement = (
        <div className="hud">
            <div className="panel">
                <b>{title}</b>
                <span>{stateLine}</span>
                <span>{statusLine}</span>
            </div>
        </div>
    )
    const stage: HTMLDivElement = <div className="stage">{canvasHost}{hud}</div>

    const speed = lifecycle.own(new DefaultObservableValue(1))
    const reactivity = lifecycle.own(new DefaultObservableValue(1))
    const speedValue = <span>1.00x</span> as HTMLSpanElement
    const reactivityValue = <span>1.00x</span> as HTMLSpanElement
    const speedInput: HTMLInputElement = (
        <input type="range" min="0.1" max="3" step="0.05" value="1"
               oninput={() => {
                   const value = parseFloat(speedInput.value)
                   speed.setValue(value)
                   speedValue.textContent = `${value.toFixed(2)}x`
               }}/>
    )
    const reactivityInput: HTMLInputElement = (
        <input type="range" min="0" max="2" step="0.05" value="1"
               oninput={() => {
                   const value = parseFloat(reactivityInput.value)
                   reactivity.setValue(value)
                   reactivityValue.textContent = `${value.toFixed(2)}x`
               }}/>
    )
    const presetSelect: HTMLSelectElement = (
        <select>
            {PRESETS.map(preset => <option value={preset.name}>{preset.name}</option>)}
        </select>
    )
    const spinInput: HTMLInputElement = <input type="checkbox" checked/>
    const controlsBar: HTMLDivElement = (
        <div className="controls">
            <label>Preset {presetSelect}</label>
            <label>Speed {speedInput} {speedValue}</label>
            <label>Reactivity {reactivityInput} {reactivityValue}</label>
            <label>{spinInput} Free spin</label>
        </div>
    )
    const element: HTMLDivElement = <div className={className}>{controlsBar}{stage}</div>

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x020305)
    scene.fog = new THREE.FogExp2(0x020305, 0.022)

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120)

    const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: "high-performance"})
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    canvasHost.appendChild(renderer.domElement)

    // Free-look on demand: auto-orbits by itself, but a drag/scroll/pinch takes over
    // immediately and OrbitControls' own damping hands auto-rotate back a moment after release.
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.2, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 4
    controls.maxDistance = 45
    controls.maxPolarAngle = Math.PI * 0.49 // stop just short of going under the floor
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.6
    camera.position.setFromSphericalCoords(15, Math.PI / 2 - 0.38, 0)
    controls.update()

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.5, 0.7, 0.1)
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    // The bar grid: one InstancedMesh, unlit (MeshBasicMaterial) so bar brightness maps
    // directly to bloom intensity instead of depending on scene lighting.
    const barGeometry = new THREE.BoxGeometry(0.3, 1, 0.3)
    const barMaterial = new THREE.MeshBasicMaterial({color: 0xffffff})
    const bars = new THREE.InstancedMesh(barGeometry, barMaterial, BAR_COUNT)
    bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const barBins = new Int32Array(BAR_COUNT)
    const barAngles = new Float32Array(BAR_COUNT)
    const half = (GRID_SIZE - 1) / 2
    for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
            const index = i * GRID_SIZE + j
            const dx = i - half, dz = j - half
            const dist = Math.hypot(dx, dz) / Math.hypot(half, half) // 0 at center, 1 at corners
            barBins[index] = Math.min(255, Math.floor(Math.pow(dist, 1.3) * 230))
            barAngles[index] = Math.atan2(dz, dx)
            dummy.position.set(dx * BAR_SPACING, 0, dz * BAR_SPACING)
            dummy.scale.set(1, 0.01, 1)
            dummy.updateMatrix()
            bars.setMatrixAt(index, dummy.matrix)
            bars.setColorAt(index, barColor.setHSL(0.48, 1, 0.1))
        }
    }
    scene.add(bars)

    // Faint XYZ axis gizmo at the origin, under the bar grid.
    const axisGroup = new THREE.Group()
    const axisLength = 9
    const addAxis = (dir: THREE.Vector3, color: number): void => {
        const points = [new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(axisLength)]
        const geometry = new THREE.BufferGeometry().setFromPoints(points)
        const material = new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.25})
        axisGroup.add(new THREE.Line(geometry, material))
    }
    addAxis(new THREE.Vector3(1, 0, 0), 0xff3366)
    addAxis(new THREE.Vector3(0, 1, 0), 0x33ff88)
    addAxis(new THREE.Vector3(0, 0, 1), 0x3399ff)
    scene.add(axisGroup)

    const floorGrid = new THREE.GridHelper(GRID_SIZE * BAR_SPACING * 1.4, 28, 0x0affd9, 0x0a2a2e)
    ;(floorGrid.material as THREE.Material).transparent = true
    ;(floorGrid.material as THREE.Material).opacity = 0.35
    scene.add(floorGrid)

    // A pulsing wireframe core, tying back to the ASCII 3D view's shapes. Each preset just
    // points it at a different pre-built geometry rather than rebuilding anything.
    const coreGeometries: Record<CoreShape, THREE.BufferGeometry> = {
        icosahedron: new THREE.IcosahedronGeometry(1.4, 1),
        torusKnot: new THREE.TorusKnotGeometry(1, 0.34, 120, 16),
        octahedron: new THREE.OctahedronGeometry(1.6, 1),
        dodecahedron: new THREE.DodecahedronGeometry(1.4, 0),
        tetrahedron: new THREE.TetrahedronGeometry(1.7, 1),
        mobius: new ParametricGeometry(mobius, 120, 24)
    }
    const coreMaterial = new THREE.MeshBasicMaterial({color: 0x66ffe0, wireframe: true, transparent: true, opacity: 0.85})
    const core = new THREE.Mesh(coreGeometries.icosahedron, coreMaterial)
    core.position.y = 3.2
    scene.add(core)

    // "Orbital System" preset: a little sun-and-planets rig orbiting the core on its own
    // inclined planes, each planet's size/speed pulled from a different spectrum bin.
    const planetGroup = new THREE.Group()
    planetGroup.visible = false
    const planetGeometry = new THREE.SphereGeometry(0.22, 16, 16)
    const planets: ReadonlyArray<{mesh: THREE.Mesh, radius: number, tilt: number, speed: number, bin: number}> =
        Array.from({length: PLANET_COUNT}, (_, i) => {
            const material = new THREE.MeshBasicMaterial({color: 0xffffff})
            const mesh = new THREE.Mesh(planetGeometry, material)
            const orbit = new THREE.Group()
            orbit.rotation.x = (i / PLANET_COUNT) * 0.6
            orbit.rotation.z = (i / PLANET_COUNT) * 1.3
            orbit.add(mesh)
            planetGroup.add(orbit)
            mesh.userData.orbit = orbit
            return {mesh, radius: 2.4 + i * 0.9, tilt: i * 0.5, speed: 0.25 + i * 0.07, bin: 20 + i * 30}
        })
    planetGroup.position.y = 3.2
    scene.add(planetGroup)

    // VGA tribute plane: a real textured mesh in the scene, not a DOM overlay.
    const vgaCanvas = document.createElement("canvas")
    vgaCanvas.width = FB_WIDTH
    vgaCanvas.height = FB_HEIGHT
    const vgaCtx = vgaCanvas.getContext("2d")
    const vgaTexture = new THREE.CanvasTexture(vgaCanvas)
    vgaTexture.magFilter = THREE.NearestFilter
    vgaTexture.minFilter = THREE.NearestFilter
    vgaTexture.generateMipmaps = false
    const vgaGeometry = new THREE.PlaneGeometry(6.4, 4)
    const vgaMaterial = new THREE.MeshBasicMaterial({map: vgaTexture})
    const vgaPlane = new THREE.Mesh(vgaGeometry, vgaMaterial)
    const vgaRestPosition = new THREE.Vector3(0, 3.2, 0)
    vgaPlane.position.copy(vgaRestPosition)
    vgaPlane.visible = false
    scene.add(vgaPlane)
    const vgaBounce: VgaBounce = {x: FB_WIDTH / 2, y: FB_HEIGHT / 2 + 20, vx: 1.3, vy: 1.0, colorIndex: 0, pulse: 0}
    const vgaCycle = {value: 0}

    // Easter egg: "hanging on a balloon" - most of the time the screen just sits flat and still,
    // but on a random 0-100 second timer (or a direct click on the screen) it breaks loose and
    // floats/tumbles in full 3D for a while, revealing it was a real plane in the scene all along.
    const scheduleNextBalloon = (now: number): number => now + Math.random() * 100_000
    let vgaFlipActive = false
    let vgaFlipStart = 0
    let vgaFlipEnd = 0
    let vgaNextFlipAt = scheduleNextBalloon(performance.now())
    const triggerVgaFlip = (now: number): void => {
        vgaFlipActive = true
        vgaFlipStart = now
        vgaFlipEnd = now + 12_000 + Math.random() * 8_000
    }
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pointerDownAt: {x: number, y: number} | null = null
    renderer.domElement.addEventListener("pointerdown", event => {
        pointerDownAt = {x: event.clientX, y: event.clientY}
    })
    renderer.domElement.addEventListener("pointerup", event => {
        if (!activePreset.vga || pointerDownAt === null) {pointerDownAt = null; return}
        const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y)
        pointerDownAt = null
        if (moved > 6) {return} // a drag (orbiting the camera), not a click
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        if (raycaster.intersectObject(vgaPlane).length > 0) {triggerVgaFlip(performance.now())}
    })

    const starGeometry = new THREE.BufferGeometry()
    const starPositions = new Float32Array(STAR_COUNT * 3)
    const starColors = new Float32Array(STAR_COUNT * 3)
    const starPalette = [new THREE.Color(0x3399ff), new THREE.Color(0xff33aa), new THREE.Color(0x66ffe0)]
    for (let i = 0; i < STAR_COUNT; i++) {
        starPositions[i * 3] = (Math.random() - 0.5) * 90
        starPositions[i * 3 + 1] = (Math.random() - 0.5) * 90
        starPositions[i * 3 + 2] = (Math.random() - 0.5) * 90
        const color = starPalette[i % starPalette.length]
        starColors[i * 3] = color.r; starColors[i * 3 + 1] = color.g; starColors[i * 3 + 2] = color.b
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3))
    starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3))
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
        size: 0.09, transparent: true, opacity: 0.8, vertexColors: true
    }))
    scene.add(stars)

    const resize = (): boolean => {
        const width = canvasHost.clientWidth, height = canvasHost.clientHeight
        if (width === 0 || height === 0) {return false}
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height, false)
        composer.setSize(width, height)
        return true
    }

    const spectrum = new Uint8Array(256)
    const audio: AudioState = {lastTime: performance.now(), bassEnvelope: 0, punch: 0}
    let activePreset = PRESETS[0]
    const floorTint = (floorGrid.material as THREE.Material & {color: THREE.Color}).color
    const starTint = (stars.material as THREE.PointsMaterial).color

    const applyPreset = (preset: Preset): void => {
        activePreset = preset
        core.geometry = coreGeometries[preset.shape]
        core.visible = !preset.planets && !preset.vga
        bars.visible = !preset.vga
        planetGroup.visible = preset.planets === true
        vgaPlane.visible = preset.vga === true
        floorTint.set(preset.tint)
        starTint.set(preset.tint)
        if (preset.vga) {
            vgaNextFlipAt = scheduleNextBalloon(performance.now())
            vgaFlipActive = false
        }
    }
    applyPreset(PRESETS[0])
    presetSelect.addEventListener("change", () => {
        const preset = PRESETS.find(p => p.name === presetSelect.value)
        if (preset !== undefined) {applyPreset(preset)}
    })

    lifecycle.own(AnimationFrame.add(() => {
        if (element.closest("[hidden]") !== null) {return}
        if (!resize()) {return}
        player.getSpectrum(spectrum)
        const now = performance.now()
        const {bass, mid, treble, punch} = sampleBands(spectrum, now, audio)
        const seconds = now * 0.001
        const speedValueNow = speed.getValue()
        const reactivityValueNow = reactivity.getValue()
        const preset = activePreset

        if (!preset.vga) {
            for (let index = 0; index < BAR_COUNT; index++) {
                const level = spectrum[barBins[index]] / 255
                // Sizes go wild: a steep curve plus a punch-driven overshoot, so quiet bars stay
                // low but a beat sends them shooting well past their steady-state height.
                const height = 0.05 + Math.pow(level, 1.6) * 10 * (0.5 + reactivityValueNow) + punch * 3.5 * reactivityValueNow
                const i = Math.floor(index / GRID_SIZE), j = index % GRID_SIZE
                const dx = i - half, dz = j - half
                dummy.position.set(dx * BAR_SPACING, height / 2 - 0.5, dz * BAR_SPACING)
                dummy.scale.set(1, Math.max(0.02, height), 1)
                dummy.updateMatrix()
                bars.setMatrixAt(index, dummy.matrix)
                const hue = (preset.hueBase + (barAngles[index] / (Math.PI * 2)) * preset.hueSpread + seconds * preset.hueSpeed * speedValueNow + 1) % 1
                const lightness = 0.08 + level * 0.65 + punch * 0.25 * reactivityValueNow
                bars.setColorAt(index, barColor.setHSL(hue, 0.9, Math.min(0.95, lightness)))
            }
            bars.instanceMatrix.needsUpdate = true
            if (bars.instanceColor) {bars.instanceColor.needsUpdate = true}
        }

        // Free spin vs static: the checkbox simply flips OrbitControls' autoRotate; a
        // drag/scroll/pinch still always takes over immediately either way.
        controls.autoRotate = spinInput.checked
        controls.autoRotateSpeed = 0.6 * speedValueNow + punch * 5 * reactivityValueNow
        controls.target.y = 1.2 + Math.sin(seconds * 0.2) * 0.3 * reactivityValueNow
        controls.update()

        if (preset.planets) {
            for (const planet of planets) {
                const level = spectrum[planet.bin] / 255
                const orbit = planet.mesh.userData.orbit as THREE.Group
                orbit.rotation.y = seconds * planet.speed * speedValueNow + planet.tilt
                planet.mesh.position.set(planet.radius * (1 + level * 0.15 * reactivityValueNow), 0, 0)
                const scale = 0.6 + level * 2.2 * reactivityValueNow + punch * 1.2
                planet.mesh.scale.setScalar(scale)
                const hue = (preset.hueBase + planet.tilt * 0.12 + seconds * preset.hueSpeed) % 1
                ;(planet.mesh.material as THREE.MeshBasicMaterial).color.setHSL(hue, 0.85, 0.3 + level * 0.5)
            }
        }

        if (preset.vga && vgaCtx !== null) {
            if (!vgaFlipActive && now >= vgaNextFlipAt) {triggerVgaFlip(now)}
            if (vgaFlipActive && now >= vgaFlipEnd) {
                vgaFlipActive = false
                vgaNextFlipAt = scheduleNextBalloon(now)
            }
            if (vgaFlipActive) {
                // Hanging-on-a-balloon sway plus a full 3D tumble while it's loose.
                const t = (now - vgaFlipStart) * 0.001
                vgaPlane.position.x = vgaRestPosition.x + Math.sin(t * 0.9) * 1.1
                vgaPlane.position.y = vgaRestPosition.y + Math.sin(t * 1.3) * 0.5 + 0.3
                vgaPlane.position.z = vgaRestPosition.z + Math.cos(t * 0.7) * 1.1
                vgaPlane.rotation.y = t * 1.1 * speedValueNow
                vgaPlane.rotation.x = Math.sin(t * 0.6) * 0.6
                vgaPlane.rotation.z = Math.sin(t * 0.4) * 0.3
            } else {
                // Drift gently back to resting flat whenever it's not actively flipping.
                vgaPlane.position.lerp(vgaRestPosition, 0.08)
                vgaPlane.rotation.x *= 0.9
                vgaPlane.rotation.y *= 0.9
                vgaPlane.rotation.z *= 0.9
            }

            vgaCtx.fillStyle = VGA_PALETTE[1]
            vgaCtx.fillRect(0, 0, FB_WIDTH, FB_HEIGHT)
            vgaCtx.strokeStyle = VGA_PALETTE[14]
            vgaCtx.lineWidth = 2
            vgaCtx.strokeRect(3, 3, FB_WIDTH - 6, FB_HEIGHT - 6)
            vgaCtx.strokeStyle = VGA_PALETTE[15]
            vgaCtx.lineWidth = 1
            vgaCtx.strokeRect(7, 7, FB_WIDTH - 14, FB_HEIGHT - 14)

            vgaCtx.textBaseline = "top"
            vgaCtx.textAlign = "center"
            vgaCtx.font = "bold 12px ui-monospace, Menlo, Consolas, monospace"
            vgaCtx.fillStyle = VGA_PALETTE[14]
            vgaCtx.fillText("P R O T R A C K E R +   4 . 2 B", FB_WIDTH / 2, 14)
            vgaCtx.font = "9px ui-monospace, Menlo, Consolas, monospace"
            vgaCtx.fillStyle = VGA_PALETTE[11]
            vgaCtx.fillText("- V G A   T R I B U T E   S C R E E N -", FB_WIDTH / 2, 28)

            const status = player.currentStatus
            const playing = player.playing.getValue()
            vgaCtx.font = "9px ui-monospace, Menlo, Consolas, monospace"
            vgaCtx.fillStyle = playing ? VGA_PALETTE[10] : VGA_PALETTE[7]
            vgaCtx.fillText(playing ? "** PLAYING **" : "** STANDBY **", FB_WIDTH / 2, 40)
            vgaCtx.fillStyle = VGA_PALETTE[7]
            const info = isDefined(status)
                ? `POS ${status.pos.toString().padStart(2, "0")}  PAT ${status.pattern.toString().padStart(2, "0")}  ROW ${status.row.toString().padStart(2, "0")}  SPD ${status.speed}/${status.tempo}  ${formatElapsed(player.elapsedMs)}`
                : "LOAD A MODULE AND PRESS PLAY"
            vgaCtx.fillText(info, FB_WIDTH / 2, 51)

            const cycleSpeed = 6 * speedValueNow * (1 + bass * reactivityValueNow)
            vgaCycle.value = (vgaCycle.value + cycleSpeed * (1 / 60)) % VGA_PALETTE.length
            const barY = 62, barHeight = 10, swatches = 16
            const swatchWidth = (FB_WIDTH - 16) / swatches
            for (let i = 0; i < swatches; i++) {
                const index = Math.floor((i + vgaCycle.value) % VGA_PALETTE.length)
                vgaCtx.fillStyle = VGA_PALETTE[index]
                vgaCtx.fillRect(8 + i * swatchWidth, barY, Math.ceil(swatchWidth), barHeight)
            }
            vgaCtx.strokeStyle = VGA_PALETTE[0]
            vgaCtx.lineWidth = 1
            vgaCtx.strokeRect(8, barY, FB_WIDTH - 16, barHeight)

            const playAreaTop = barY + barHeight + 10
            const playAreaBottom = FB_HEIGHT - 26
            const baseRadius = 11
            const moveSpeed = speedValueNow * (1 + bass * 0.6 * reactivityValueNow)
            vgaBounce.x += vgaBounce.vx * moveSpeed
            vgaBounce.y += vgaBounce.vy * moveSpeed
            let bounced = false
            if (vgaBounce.x - baseRadius < 10) {vgaBounce.x = 10 + baseRadius; vgaBounce.vx = Math.abs(vgaBounce.vx); bounced = true}
            if (vgaBounce.x + baseRadius > FB_WIDTH - 10) {vgaBounce.x = FB_WIDTH - 10 - baseRadius; vgaBounce.vx = -Math.abs(vgaBounce.vx); bounced = true}
            if (vgaBounce.y - baseRadius < playAreaTop) {vgaBounce.y = playAreaTop + baseRadius; vgaBounce.vy = Math.abs(vgaBounce.vy); bounced = true}
            if (vgaBounce.y + baseRadius > playAreaBottom) {vgaBounce.y = playAreaBottom - baseRadius; vgaBounce.vy = -Math.abs(vgaBounce.vy); bounced = true}
            if (bounced) {vgaBounce.colorIndex = (vgaBounce.colorIndex + 1) % VGA_BOUNCE_COLORS.length; vgaBounce.pulse = 1}
            vgaBounce.pulse *= 0.9
            const radius = baseRadius * (1 + vgaBounce.pulse * 0.6 + punch * 1.2 * reactivityValueNow)
            drawVgaDiamond(vgaCtx, vgaBounce.x, vgaBounce.y, radius, VGA_PALETTE[VGA_BOUNCE_COLORS[vgaBounce.colorIndex]])
            vgaCtx.strokeStyle = VGA_PALETTE[15]
            vgaCtx.lineWidth = 1
            vgaCtx.beginPath()
            vgaCtx.moveTo(vgaBounce.x, vgaBounce.y - radius)
            vgaCtx.lineTo(vgaBounce.x + radius, vgaBounce.y)
            vgaCtx.lineTo(vgaBounce.x, vgaBounce.y + radius)
            vgaCtx.lineTo(vgaBounce.x - radius, vgaBounce.y)
            vgaCtx.closePath()
            vgaCtx.stroke()

            const twinkleCount = 40
            for (let i = 0; i < twinkleCount; i++) {
                const seedVal = i * 97.31
                const x = 12 + ((seedVal * 13.7 + seconds * 4 * speedValueNow) % (FB_WIDTH - 24))
                const y = playAreaTop + ((seedVal * 7.3) % (playAreaBottom - playAreaTop))
                const flicker = (Math.sin(seconds * 3 + i) + 1) / 2
                if (flicker > 0.6 - treble * reactivityValueNow * 0.3) {
                    vgaCtx.fillStyle = VGA_PALETTE[8 + (i % 8)]
                    vgaCtx.fillRect(Math.floor(x), Math.floor(y), 1, 1)
                }
            }

            const scrollSpeed = 40 * speedValueNow * (1 + punch * reactivityValueNow)
            vgaCtx.font = "11px ui-monospace, Menlo, Consolas, monospace"
            const measuredWidth = vgaCtx.measureText(VGA_SCROLLTEXT).width
            const loopWidth = measuredWidth + FB_WIDTH
            const x0 = FB_WIDTH - ((seconds * scrollSpeed) % loopWidth)
            vgaCtx.textAlign = "left"
            vgaCtx.fillStyle = VGA_PALETTE[0]
            vgaCtx.fillRect(6, FB_HEIGHT - 22, FB_WIDTH - 12, 14)
            vgaCtx.strokeStyle = VGA_PALETTE[6]
            vgaCtx.strokeRect(6, FB_HEIGHT - 22, FB_WIDTH - 12, 14)
            vgaCtx.save()
            vgaCtx.beginPath()
            vgaCtx.rect(8, FB_HEIGHT - 22, FB_WIDTH - 16, 14)
            vgaCtx.clip()
            vgaCtx.fillStyle = VGA_PALETTE[14]
            vgaCtx.fillText(VGA_SCROLLTEXT, x0, FB_HEIGHT - 20)
            vgaCtx.fillText(VGA_SCROLLTEXT, x0 - loopWidth, FB_HEIGHT - 20)
            vgaCtx.restore()

            vgaCtx.fillStyle = "rgba(0, 0, 0, 0.22)"
            for (let y = 0; y < FB_HEIGHT; y += 2) {vgaCtx.fillRect(0, y, FB_WIDTH, 1)}

            vgaTexture.needsUpdate = true
        } else {
            core.rotation.x = seconds * 0.4 * speedValueNow
            core.rotation.y = seconds * 0.6 * speedValueNow
            // Wild core pulse: bass alone nearly doubles it, a punch hit can triple it briefly.
            const coreScale = 1 + bass * 1.6 * reactivityValueNow + punch * 1.4
            core.scale.setScalar(coreScale)
            ;(core.material as THREE.MeshBasicMaterial).color.setHSL((preset.hueBase + (seconds * preset.hueSpeed) % preset.hueSpread) % 1, 0.8, 0.65)
        }

        axisGroup.rotation.y = seconds * 0.05 * speedValueNow
        stars.rotation.y = seconds * 0.01 * speedValueNow
        stars.rotation.x = Math.sin(seconds * 0.03) * 0.1

        bloomPass.strength = 1.3 + punch * 2 * reactivityValueNow + treble * 0.4
        ;(floorGrid.material as THREE.Material).opacity = 0.25 + mid * 0.5 * reactivityValueNow

        const status = player.currentStatus
        stateLine.value = player.playing.getValue() ? "PLAYING" : "STANDBY"
        statusLine.value = isDefined(status)
            ? `POS ${status.pos.toString().padStart(2, "0")}  PAT ${status.pattern.toString().padStart(2, "0")}  ROW ${status.row.toString().padStart(2, "0")}`
            : "LOAD A MODULE AND PRESS PLAY"

        composer.render()
    }))

    lifecycle.own(Terminable.create(() => {
        barGeometry.dispose()
        barMaterial.dispose()
        Object.values(coreGeometries).forEach(geometry => geometry.dispose())
        coreMaterial.dispose()
        planetGeometry.dispose()
        planets.forEach(planet => (planet.mesh.material as THREE.MeshBasicMaterial).dispose())
        vgaGeometry.dispose()
        vgaMaterial.dispose()
        vgaTexture.dispose()
        starGeometry.dispose()
        ;(stars.material as THREE.PointsMaterial).dispose()
        ;(floorGrid.material as THREE.Material).dispose()
        floorGrid.geometry.dispose()
        axisGroup.children.forEach(child => {
            const line = child as THREE.Line
            line.geometry.dispose()
            ;(line.material as THREE.Material).dispose()
        })
        composer.dispose()
        renderer.dispose()
    }))

    return element
}
