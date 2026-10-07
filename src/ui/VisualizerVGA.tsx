import css from "./VisualizerVGA.sass?inline"
import {DefaultObservableValue, isDefined, Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {AnimationFrame, Html} from "@opendaw/lib-dom"
import {Player} from "@/Player"
import {AudioState, sampleBands} from "@/ui/audioReactive"

const className = Html.adoptStyleSheet(css, "VisualizerVGA")

// The internal framebuffer is deliberately tiny (classic VGA mode 13h territory) and then
// stretched up via CSS `image-rendering: pixelated`, which is what gives the whole view its
// chunky, early-90s DOS feel without needing any bitmap font assets.
const FB_WIDTH = 320
const FB_HEIGHT = 200

// Standard 16-color EGA/VGA palette.
const PALETTE = [
    "#000000", "#0000AA", "#00AA00", "#00AAAA",
    "#AA0000", "#AA00AA", "#AA5500", "#AAAAAA",
    "#555555", "#5555FF", "#55FF55", "#55FFFF",
    "#FF5555", "#FF55FF", "#FFFF55", "#FFFFFF"
] as const

const BOUNCE_COLORS = [9, 10, 11, 12, 13, 14, 15, 3, 2]

// Entirely original, good-natured tribute text - no real group, intro or scrolltext is
// referenced or paraphrased here, just our own greeting to tracker/chiptune culture.
const SCROLLTEXT =
    "   WELCOME TO THE PROTRACKER+ 4.2B VGA TRIBUTE SCREEN ...   " +
    "THIS IS A SMALL ORIGINAL HOMAGE TO THE EARLY-1990S HOME COMPUTER AND DOS DEMOSCENE, " +
    "WHEN A FLOPPY DISK, A TRACKER AND A FEW KILOBYTES OF CODE COULD MAKE SOMETHING TRULY MAGICAL ...   " +
    "BIG RESPECT AND GREETINGS TO EVERY COMPOSER, CODER, PIXEL ARTIST AND CHIPTUNE FAN " +
    "WHO KEEPS WRITING MODULES AND SHARING MUSIC TO THIS DAY ...   " +
    "LONG LIVE THE AMIGA, THE PC, THE TRACKER AND THE SCENE ...   " +
    "THANKS FOR LISTENING ON PROTRACKER+ - NOW GO MAKE SOME NOISE ...   "

type Construct = {
    lifecycle: Lifecycle
    player: Player
}

type Controls = {
    speed: DefaultObservableValue<number>
    reactivity: DefaultObservableValue<number>
}

type BounceState = {
    x: number
    y: number
    vx: number
    vy: number
    colorIndex: number
    pulse: number
}

const formatElapsed = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.min(99, Math.floor(totalSeconds / 60))
    const seconds = totalSeconds % 60
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

const drawDiamond = (ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string): void => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(cx, cy - radius)
    ctx.lineTo(cx + radius, cy)
    ctx.lineTo(cx, cy + radius)
    ctx.lineTo(cx - radius, cy)
    ctx.closePath()
    ctx.fill()
}

const draw = (ctx: CanvasRenderingContext2D, player: Player, spectrum: Uint8Array, time: number,
              audio: AudioState, controls: Controls, bounce: BounceState, cycleOffset: { value: number }): void => {
    const {bass, treble, punch} = sampleBands(spectrum, time, audio)
    const speedBase = controls.speed.getValue()
    const reactivity = controls.reactivity.getValue()
    const seconds = time * 0.001

    // Background band: a deep VGA blue, the classic DOS full-screen backdrop color.
    ctx.fillStyle = PALETTE[1]
    ctx.fillRect(0, 0, FB_WIDTH, FB_HEIGHT)

    // Double-lined border frame.
    ctx.strokeStyle = PALETTE[14]
    ctx.lineWidth = 2
    ctx.strokeRect(3, 3, FB_WIDTH - 6, FB_HEIGHT - 6)
    ctx.strokeStyle = PALETTE[15]
    ctx.lineWidth = 1
    ctx.strokeRect(7, 7, FB_WIDTH - 14, FB_HEIGHT - 14)

    ctx.textBaseline = "top"
    ctx.textAlign = "center"
    ctx.font = "bold 12px ui-monospace, Menlo, Consolas, monospace"
    ctx.fillStyle = PALETTE[14]
    ctx.fillText("P R O T R A C K E R +   4 . 2 B", FB_WIDTH / 2, 14)
    ctx.font = "9px ui-monospace, Menlo, Consolas, monospace"
    ctx.fillStyle = PALETTE[11]
    ctx.fillText("- V G A   T R I B U T E   S C R E E N -", FB_WIDTH / 2, 28)

    const status = player.currentStatus
    const playing = player.playing.getValue()
    ctx.font = "9px ui-monospace, Menlo, Consolas, monospace"
    ctx.fillStyle = playing ? PALETTE[10] : PALETTE[7]
    ctx.fillText(playing ? "** PLAYING **" : "** STANDBY **", FB_WIDTH / 2, 40)
    ctx.fillStyle = PALETTE[7]
    const info = isDefined(status)
        ? `POS ${status.pos.toString().padStart(2, "0")}  PAT ${status.pattern.toString().padStart(2, "0")}  ROW ${status.row.toString().padStart(2, "0")}  SPD ${status.speed}/${status.tempo}  ${formatElapsed(player.elapsedMs)}`
        : "LOAD A MODULE AND PRESS PLAY"
    ctx.fillText(info, FB_WIDTH / 2, 51)

    // Color-cycling palette bar: a classic VGA trick where the swatches stay put but the
    // palette index feeding each one rotates every frame - here simulated directly since we
    // draw straight to a canvas rather than owning a real hardware palette.
    const cycleSpeed = 6 * speedBase * (1 + bass * reactivity)
    cycleOffset.value = (cycleOffset.value + cycleSpeed * (1 / 60)) % PALETTE.length
    const barY = 62
    const barHeight = 10
    const swatches = 16
    const swatchWidth = (FB_WIDTH - 16) / swatches
    for (let i = 0; i < swatches; i++) {
        const index = Math.floor((i + cycleOffset.value) % PALETTE.length)
        ctx.fillStyle = PALETTE[index]
        ctx.fillRect(8 + i * swatchWidth, barY, Math.ceil(swatchWidth), barHeight)
    }
    ctx.strokeStyle = PALETTE[0]
    ctx.lineWidth = 1
    ctx.strokeRect(8, barY, FB_WIDTH - 16, barHeight)

    // Bouncing shape: DVD-logo style wall bounce, color-cycles and pulses on every hit,
    // and reacts to the beat via a brief size pulse on strong transients.
    const playAreaTop = barY + barHeight + 10
    const playAreaBottom = FB_HEIGHT - 26
    const baseRadius = 11
    const moveSpeed = speedBase * (1 + bass * 0.6 * reactivity)
    bounce.x += bounce.vx * moveSpeed
    bounce.y += bounce.vy * moveSpeed
    let bounced = false
    if (bounce.x - baseRadius < 10) {bounce.x = 10 + baseRadius; bounce.vx = Math.abs(bounce.vx); bounced = true}
    if (bounce.x + baseRadius > FB_WIDTH - 10) {bounce.x = FB_WIDTH - 10 - baseRadius; bounce.vx = -Math.abs(bounce.vx); bounced = true}
    if (bounce.y - baseRadius < playAreaTop) {bounce.y = playAreaTop + baseRadius; bounce.vy = Math.abs(bounce.vy); bounced = true}
    if (bounce.y + baseRadius > playAreaBottom) {bounce.y = playAreaBottom - baseRadius; bounce.vy = -Math.abs(bounce.vy); bounced = true}
    if (bounced) {
        bounce.colorIndex = (bounce.colorIndex + 1) % BOUNCE_COLORS.length
        bounce.pulse = 1
    }
    bounce.pulse *= 0.9
    const punchPulse = punch * 1.2 * reactivity
    const radius = baseRadius * (1 + bounce.pulse * 0.6 + punchPulse)
    drawDiamond(ctx, bounce.x, bounce.y, radius, PALETTE[BOUNCE_COLORS[bounce.colorIndex]])
    ctx.strokeStyle = PALETTE[15]
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(bounce.x, bounce.y - radius)
    ctx.lineTo(bounce.x + radius, bounce.y)
    ctx.lineTo(bounce.x, bounce.y + radius)
    ctx.lineTo(bounce.x - radius, bounce.y)
    ctx.closePath()
    ctx.stroke()

    // Treble-reactive twinkling dots scattered across the play area, a nod to the
    // starfields common in intros from this era.
    const twinkleCount = 40
    for (let i = 0; i < twinkleCount; i++) {
        const seed = i * 97.31
        const x = 12 + ((seed * 13.7 + seconds * 4 * speedBase) % (FB_WIDTH - 24))
        const y = playAreaTop + ((seed * 7.3) % (playAreaBottom - playAreaTop))
        const flicker = (Math.sin(seconds * 3 + i) + 1) / 2
        if (flicker > 0.6 - treble * reactivity * 0.3) {
            ctx.fillStyle = PALETTE[8 + (i % 8)]
            ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1)
        }
    }

    // Scrolling marquee message along the bottom, speed nudged by the beat.
    const scrollSpeed = 40 * speedBase * (1 + punch * reactivity)
    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace"
    const measuredWidth = ctx.measureText(SCROLLTEXT).width
    const loopWidth = measuredWidth + FB_WIDTH
    const x0 = FB_WIDTH - ((seconds * scrollSpeed) % loopWidth)
    ctx.textAlign = "left"
    ctx.fillStyle = PALETTE[0]
    ctx.fillRect(6, FB_HEIGHT - 22, FB_WIDTH - 12, 14)
    ctx.strokeStyle = PALETTE[6]
    ctx.strokeRect(6, FB_HEIGHT - 22, FB_WIDTH - 12, 14)
    ctx.save()
    ctx.beginPath()
    ctx.rect(8, FB_HEIGHT - 22, FB_WIDTH - 16, 14)
    ctx.clip()
    ctx.fillStyle = PALETTE[14]
    ctx.fillText(SCROLLTEXT, x0, FB_HEIGHT - 20)
    ctx.fillText(SCROLLTEXT, x0 - loopWidth, FB_HEIGHT - 20)
    ctx.restore()

    // Scanline overlay, drawn straight into the framebuffer so it scales pixel-perfect
    // along with everything else.
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)"
    for (let y = 0; y < FB_HEIGHT; y += 2) {
        ctx.fillRect(0, y, FB_WIDTH, 1)
    }
}

export const VisualizerVGA = ({lifecycle, player}: Construct) => {
    const canvas: HTMLCanvasElement = <canvas width={FB_WIDTH} height={FB_HEIGHT} role="img" aria-label="VGA-style retro tribute screen"/>
    const ctx = canvas.getContext("2d")
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
    const stage: HTMLDivElement = <div className="stage">{canvas}</div>
    const element: HTMLDivElement = <div className={className}>{controlsBar}{stage}</div>

    const spectrum = new Uint8Array(256)
    const audio: AudioState = {lastTime: performance.now(), bassEnvelope: 0, punch: 0}
    const bounce: BounceState = {x: FB_WIDTH / 2, y: FB_HEIGHT / 2 + 20, vx: 1.3, vy: 1.0, colorIndex: 0, pulse: 0}
    const cycleOffset = {value: 0}

    lifecycle.own(AnimationFrame.add(() => {
        if (ctx === null || element.closest("[hidden]") !== null || element.clientWidth === 0) {return}
        player.getSpectrum(spectrum)
        draw(ctx, player, spectrum, performance.now(), audio, {speed, reactivity}, bounce, cycleOffset)
    }))

    return element
}
