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

const className = Html.adoptStyleSheet(css, "VisualizerWebGL")

const BAR_COUNT = 48
const RING_RADIUS = 5
const STAR_COUNT = 500

type Construct = {
    lifecycle: Lifecycle
    player: Player
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
    const controlsBar: HTMLDivElement = (
        <div className="controls">
            <label>Speed {speedInput} {speedValue}</label>
            <label>Reactivity {reactivityInput} {reactivityValue}</label>
        </div>
    )
    const element: HTMLDivElement = <div className={className}>{controlsBar}{stage}</div>

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x020305)
    scene.fog = new THREE.FogExp2(0x020305, 0.028)

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 5, 12)
    camera.lookAt(0, 0.5, 0)

    const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: "high-performance"})
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    canvasHost.appendChild(renderer.domElement)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.3, 0.65, 0.12)
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    const barGeometry = new THREE.BoxGeometry(0.34, 1, 0.34)
    const bars: ReadonlyArray<THREE.Mesh> = Array.from({length: BAR_COUNT}, (_, i) => {
        const angle = (i / BAR_COUNT) * Math.PI * 2
        const material = new THREE.MeshStandardMaterial({
            color: 0x0affd9, emissive: 0x0affd9, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.2
        })
        const bar = new THREE.Mesh(barGeometry, material)
        bar.position.set(Math.cos(angle) * RING_RADIUS, 0, Math.sin(angle) * RING_RADIUS)
        scene.add(bar)
        return bar
    })

    const starGeometry = new THREE.BufferGeometry()
    const starPositions = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT * 3; i++) {starPositions[i] = (Math.random() - 0.5) * 70}
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
        color: 0x3366ff, size: 0.07, transparent: true, opacity: 0.55
    }))
    scene.add(stars)

    scene.add(new THREE.AmbientLight(0x1a2a33, 0.7))
    const keyLight = new THREE.PointLight(0x0affd9, 3, 40)
    keyLight.position.set(0, 7, 2)
    scene.add(keyLight)

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
        const {mid, punch} = sampleBands(spectrum, now, audio)
        const seconds = now * 0.001
        const speedValueNow = speed.getValue()
        const reactivityValueNow = reactivity.getValue()

        for (let i = 0; i < BAR_COUNT; i++) {
            const bin = Math.floor(Math.pow(i / (BAR_COUNT - 1), 1.5) * 200)
            const level = spectrum[bin] / 255
            const bar = bars[i]
            const height = 0.25 + level * 5 * (0.6 + 0.6 * reactivityValueNow)
            bar.scale.y = height
            bar.position.y = height / 2 - 0.5
            const material = bar.material as THREE.MeshStandardMaterial
            material.emissiveIntensity = 0.3 + level * 2.2 + punch * 1.6 * reactivityValueNow
        }
        scene.rotation.y = seconds * 0.08 * speedValueNow
        stars.rotation.y = seconds * 0.015 * speedValueNow
        keyLight.intensity = 3 + mid * 6 * reactivityValueNow
        bloomPass.strength = 1.1 + punch * 1.8 * reactivityValueNow

        const status = player.currentStatus
        stateLine.value = player.playing.getValue() ? "PLAYING" : "STANDBY"
        statusLine.value = isDefined(status)
            ? `POS ${status.pos.toString().padStart(2, "0")}  PAT ${status.pattern.toString().padStart(2, "0")}  ROW ${status.row.toString().padStart(2, "0")}`
            : "LOAD A MODULE AND PRESS PLAY"

        composer.render()
    }))

    lifecycle.own(Terminable.create(() => {
        barGeometry.dispose()
        starGeometry.dispose()
        bars.forEach(bar => (bar.material as THREE.MeshStandardMaterial).dispose())
        ;(stars.material as THREE.PointsMaterial).dispose()
        composer.dispose()
        renderer.dispose()
    }))

    return element
}
