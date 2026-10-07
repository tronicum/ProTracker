import css from "./Visualizer3D.sass?inline"
import {isDefined, Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {AnimationFrame, Html} from "@opendaw/lib-dom"
import {Player} from "@/Player"

const className = Html.adoptStyleSheet(css, "Visualizer3D")

// AAlib-style luminance ramp, same family used by the classic "bb" demo intro.
const ramp = " .:-=+*#%@"

type Vec3 = readonly [number, number, number]

const PHI = (1 + Math.sqrt(5)) / 2
const RAW_VERTICES: ReadonlyArray<Vec3> = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
]
const normalizeVertex = ([x, y, z]: Vec3): Vec3 => {
    const length = Math.hypot(x, y, z)
    return [x / length, y / length, z / length]
}
const VERTICES: ReadonlyArray<Vec3> = RAW_VERTICES.map(normalizeVertex)
// Standard icosahedron triangulation (20 faces, CCW winding seen from outside).
const FACES: ReadonlyArray<readonly [number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
]

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const normalize = (v: Vec3): Vec3 => {
    const length = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / length, v[1] / length, v[2] / length]
}
const rotate = ([x, y, z]: Vec3, angleX: number, angleY: number): Vec3 => {
    const y1 = y * Math.cos(angleX) - z * Math.sin(angleX)
    const z1 = y * Math.sin(angleX) + z * Math.cos(angleX)
    const x2 = x * Math.cos(angleY) + z1 * Math.sin(angleY)
    const z2 = -x * Math.sin(angleY) + z1 * Math.cos(angleY)
    return [x2, y1, z2]
}

const lightDir = normalize([0.5, -0.6, 0.9])
const edge = (x0: number, y0: number, x1: number, y1: number, px: number, py: number): number =>
    (px - x0) * (y1 - y0) - (py - y0) * (x1 - x0)

type Construct = {
    lifecycle: Lifecycle
    player: Player
}

const draw = (screen: HTMLPreElement, spectrum: Uint8Array, player: Player, time: number): void => {
    const columns = Math.max(48, Math.min(120, Math.floor(screen.clientWidth / 7)))
    const rows = Math.max(18, Math.min(40, Math.floor(screen.clientHeight / 10)))
    const art = Array.from({length: rows}, () => Array(columns).fill(" ") as string[])
    const depth = Array.from({length: rows}, () => Array(columns).fill(Infinity) as number[])
    const write = (row: number, column: number, text: string): void => {
        if (row < 0 || row >= rows || column >= columns) {return}
        for (let index = 0; index < text.length && column + index < columns; index++) {
            art[row][column + index] = text[index]
        }
    }
    const horizontal = `+${"-".repeat(columns - 2)}+`
    for (let row = 0; row < rows; row++) {
        art[row][0] = "|"
        art[row][columns - 1] = "|"
    }
    write(0, 0, horizontal)

    let bass = 0
    for (let index = 0; index < 16; index++) {bass += spectrum[index] / 255}
    bass /= 16
    let treble = 0
    for (let index = 96; index < 160; index++) {treble += spectrum[index] / 255}
    treble /= 64

    const status = player.currentStatus
    const state = player.playing.getValue() ? "PLAYING" : "STANDBY"
    write(0, 2, ` PROTRACKER 2.3A  /  BB-STYLE ASCII 3D  /  ${state} `)

    const plotTop = 1
    const plotBottom = rows - 2
    const plotWidth = columns - 2
    const plotHeight = plotBottom - plotTop + 1
    const cx = 1 + plotWidth / 2
    const cy = plotTop + plotHeight / 2
    const seconds = time * 0.001
    const spin = 0.25 + bass * 1.4
    const angleX = seconds * 0.6 * spin
    const angleY = seconds * 0.9 * spin
    const dist = 3.0
    const scale = Math.min(plotWidth * 0.42, plotHeight * 0.78) * (1 + bass * 0.35)
    const aspect = 0.52

    const camVerts = VERTICES.map(v => rotate(v, angleX, angleY))
    const projected = camVerts.map(v => {
        const factor = dist / (dist - v[2])
        return [cx + v[0] * scale * factor, cy + v[1] * scale * factor * aspect] as const
    })
    const triangles = FACES
        .map(([ia, ib, ic]) => {
            const a = camVerts[ia], b = camVerts[ib], c = camVerts[ic]
            const normal = normalize(cross(sub(b, a), sub(c, a)))
            const avgZ = (a[2] + b[2] + c[2]) / 3
            return {ia, ib, ic, normal, avgZ}
        })
        .filter(triangle => triangle.normal[2] > 0)
        .sort((p, q) => p.avgZ - q.avgZ)

    for (const triangle of triangles) {
        const pa = projected[triangle.ia], pb = projected[triangle.ib], pc = projected[triangle.ic]
        const luminance = Math.min(1, Math.max(0, dot(triangle.normal, lightDir)) + bass * 0.25)
        const glyph = ramp[Math.min(ramp.length - 1, Math.floor(luminance * (ramp.length - 1)))]
        const minX = Math.max(1, Math.floor(Math.min(pa[0], pb[0], pc[0])))
        const maxX = Math.min(columns - 2, Math.ceil(Math.max(pa[0], pb[0], pc[0])))
        const minY = Math.max(plotTop, Math.floor(Math.min(pa[1], pb[1], pc[1])))
        const maxY = Math.min(plotBottom, Math.ceil(Math.max(pa[1], pb[1], pc[1])))
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const w0 = edge(pa[0], pa[1], pb[0], pb[1], x, y)
                const w1 = edge(pb[0], pb[1], pc[0], pc[1], x, y)
                const w2 = edge(pc[0], pc[1], pa[0], pa[1], x, y)
                const inside = (w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)
                if (inside && triangle.avgZ < depth[y][x]) {
                    depth[y][x] = triangle.avgZ
                    art[y][x] = glyph
                }
            }
        }
    }

    // Sparse treble-reactive starfield, homage to the classic bb demo background.
    const starCount = Math.floor(plotWidth * plotHeight * 0.01 * (0.3 + treble))
    for (let index = 0; index < starCount; index++) {
        const x = 1 + Math.floor((index * 97 + Math.floor(seconds * 24)) % plotWidth)
        const y = plotTop + Math.floor((index * 53 + Math.floor(seconds * 11)) % plotHeight)
        if (art[y][x] === " ") {art[y][x] = treble > 0.5 ? "." : " "}
    }

    write(rows - 1, 0, `+${"-".repeat(columns - 2)}+`)
    const label = isDefined(status)
        ? ` POS ${status.pos.toString().padStart(2, "0")}  PAT ${status.pattern.toString().padStart(2, "0")}  BASS ${(bass * 100).toFixed(0)}% `
        : " LOAD A MODULE AND PRESS PLAY "
    write(rows - 1, 2, label)
    screen.textContent = art.map(line => line.join("")).join("\n")
}

export const Visualizer3D = ({lifecycle, player}: Construct) => {
    const screen: HTMLPreElement = <pre role="img" aria-label="Music-reactive rotating 3D ASCII art"/>
    const element: HTMLDivElement = <div className={className}>{screen}</div>
    const spectrum = new Uint8Array(256)
    lifecycle.own(AnimationFrame.add(() => {
        if (element.closest("[hidden]") !== null || element.clientWidth === 0) {return}
        player.getSpectrum(spectrum)
        draw(screen, spectrum, player, performance.now())
    }))
    return element
}
