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
    const controlsBar: HTMLDivElement = (
        <div className="controls">
            <label>Speed {speedInput} {speedValue}</label>
            <label>Reactivity {reactivityInput} {reactivityValue}</label>
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

    // A pulsing wireframe core, tying back to the ASCII 3D view's shapes.
    const coreGeometry = new THREE.IcosahedronGeometry(1.4, 1)
    const coreMaterial = new THREE.MeshBasicMaterial({color: 0x66ffe0, wireframe: true, transparent: true, opacity: 0.85})
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    core.position.y = 3.2
    scene.add(core)

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

    lifecycle.own(AnimationFrame.add(() => {
        if (element.closest("[hidden]") !== null) {return}
        if (!resize()) {return}
        player.getSpectrum(spectrum)
        const now = performance.now()
        const {bass, mid, treble, punch} = sampleBands(spectrum, now, audio)
        const seconds = now * 0.001
        const speedValueNow = speed.getValue()
        const reactivityValueNow = reactivity.getValue()

        for (let index = 0; index < BAR_COUNT; index++) {
            const level = spectrum[barBins[index]] / 255
            const height = 0.05 + level * 7 * (0.55 + 0.6 * reactivityValueNow)
            const i = Math.floor(index / GRID_SIZE), j = index % GRID_SIZE
            const dx = i - half, dz = j - half
            dummy.position.set(dx * BAR_SPACING, height / 2 - 0.5, dz * BAR_SPACING)
            dummy.scale.set(1, Math.max(0.02, height), 1)
            dummy.updateMatrix()
            bars.setMatrixAt(index, dummy.matrix)
            const hue = (0.48 + barAngles[index] / (Math.PI * 2) + seconds * 0.015 * speedValueNow) % 1
            const lightness = 0.08 + level * 0.65 + punch * 0.25 * reactivityValueNow
            bars.setColorAt(index, barColor.setHSL(hue, 0.9, Math.min(0.95, lightness)))
        }
        bars.instanceMatrix.needsUpdate = true
        if (bars.instanceColor) {bars.instanceColor.needsUpdate = true}

        // Free-look on demand: dragging/scrolling takes the camera over immediately;
        // left alone, it auto-orbits at a speed that picks up with the music.
        controls.autoRotateSpeed = 0.6 * speedValueNow + punch * 4 * reactivityValueNow
        controls.target.y = 1.2 + Math.sin(seconds * 0.2) * 0.3 * reactivityValueNow
        controls.update()

        core.rotation.x = seconds * 0.4 * speedValueNow
        core.rotation.y = seconds * 0.6 * speedValueNow
        const coreScale = 1 + bass * 0.8 * reactivityValueNow + punch * 0.6
        core.scale.setScalar(coreScale)
        ;(core.material as THREE.MeshBasicMaterial).color.setHSL((seconds * 0.05) % 1, 0.8, 0.65)

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
        coreGeometry.dispose()
        coreMaterial.dispose()
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
