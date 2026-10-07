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

type CoreShape = "icosahedron" | "torusKnot" | "octahedron" | "dodecahedron" | "tetrahedron"

type Preset = {
    name: string
    shape: CoreShape
    hueBase: number   // 0-1, center of the palette
    hueSpread: number // how much of the wheel the grid/stars sweep across
    hueSpeed: number  // how fast the sweep drifts over time
    tint: number      // multiplies the floor grid + starfield's baked-in vertex colors
    planets?: boolean // swap the wireframe core for a little orbiting solar system
}

// Eleven distinct looks over the same scene: different centerpiece shape and color
// treatment, picked from a dropdown - cheap to add more without rebuilding geometry.
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
    {name: "Orbital System", shape: "icosahedron", hueBase: 0.58, hueSpread: 0.5, hueSpeed: 0.01, tint: 0xffffff, planets: true}
]

const PLANET_COUNT = 6

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
        tetrahedron: new THREE.TetrahedronGeometry(1.7, 1)
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
        core.visible = !preset.planets
        planetGroup.visible = preset.planets === true
        floorTint.set(preset.tint)
        starTint.set(preset.tint)
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

        core.rotation.x = seconds * 0.4 * speedValueNow
        core.rotation.y = seconds * 0.6 * speedValueNow
        // Wild core pulse: bass alone nearly doubles it, a punch hit can triple it briefly.
        const coreScale = 1 + bass * 1.6 * reactivityValueNow + punch * 1.4
        core.scale.setScalar(coreScale)
        ;(core.material as THREE.MeshBasicMaterial).color.setHSL((preset.hueBase + (seconds * preset.hueSpeed) % preset.hueSpread) % 1, 0.8, 0.65)

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
