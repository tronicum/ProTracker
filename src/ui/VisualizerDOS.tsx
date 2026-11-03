import css from "./VisualizerDOS.sass?inline"
import {Lifecycle, Terminable} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"

const className = Html.adoptStyleSheet(css, "VisualizerDOS")

// js-dos (DOSBox compiled to WebAssembly, https://js-dos.com) loaded from its own CDN rather
// than bundled - it pulls in its own large UI framework stack (preact/redux) we don't want in
// this project's build, and the CDN build is what their own docs recommend embedding.
const JSDOS_SCRIPT_URL = "https://v8.js-dos.com/latest/js-dos.js"
const JSDOS_CSS_URL = "https://v8.js-dos.com/latest/js-dos.css"
// "Digger" (1983, Windmill Software) - long-established freeware/public-domain DOS game, and
// js-dos's own canonical getting-started example, bundled and hosted on their CDN. We neither
// host nor redistribute the game binary ourselves.
const DIGGER_BUNDLE_URL = "https://v8.js-dos.com/bundles/digger.jsdos"

type DosProps = {
    setPaused(paused: boolean): void
    setVolume(volume: number): void
    stop(): Promise<void>
}

declare global {
    interface Window {
        Dos?: (element: HTMLElement, options: {url: string}) => DosProps
    }
}

let jsDosLoad: Promise<void> | null = null

const ensureJsDosLoaded = (): Promise<void> => {
    if (jsDosLoad !== null) {return jsDosLoad}
    jsDosLoad = new Promise((resolve, reject) => {
        if (document.querySelector(`link[data-js-dos]`) === null) {
            const link = document.createElement("link")
            link.rel = "stylesheet"
            link.href = JSDOS_CSS_URL
            link.dataset.jsDos = "true"
            document.head.appendChild(link)
        }
        const existing = document.querySelector<HTMLScriptElement>(`script[data-js-dos]`)
        if (existing !== null) {
            if (window.Dos !== undefined) {resolve(); return}
            existing.addEventListener("load", () => resolve())
            existing.addEventListener("error", () => reject(new Error("failed to load js-dos")))
            return
        }
        const script = document.createElement("script")
        script.src = JSDOS_SCRIPT_URL
        script.dataset.jsDos = "true"
        script.onload = () => resolve()
        script.onerror = () => reject(new Error("failed to load js-dos"))
        document.head.appendChild(script)
    })
    return jsDosLoad
}

type Construct = {
    lifecycle: Lifecycle
}

export const VisualizerDOS = ({lifecycle}: Construct) => {
    const status = <span className="status">Click this tab to boot DOSBox…</span> as HTMLSpanElement
    const container: HTMLDivElement = <div className="dos-container"/>
    const element: HTMLDivElement = (
        <div className={className}>
            <div className="panel">
                <b>LIVE DOSBOX</b>
                <span>Running "Digger" (1983, Windmill Software, freeware) via js-dos - a real DOSBox
                    running in WebAssembly, not an emulation of one.</span>
            </div>
            {status}
            {container}
        </div>
    )

    let dos: DosProps | null = null
    let starting = false

    // Lazy: don't download the ~MB emulator bundle or start the game (with audio!) until the
    // user actually opens this tab, even though every view in this app mounts up front.
    const activateIfVisible = (): void => {
        if (dos !== null) {
            dos.setPaused(Boolean(element.hidden))
            return
        }
        if (element.hidden || starting) {return}
        starting = true
        status.textContent = "Loading DOSBox…"
        ensureJsDosLoaded()
            .then(() => {
                const factory = window.Dos
                if (factory === undefined) {throw new Error("js-dos failed to initialize")}
                status.hidden = true
                dos = factory(container, {url: DIGGER_BUNDLE_URL})
            })
            .catch(reason => {
                starting = false
                status.textContent = `Failed to load DOSBox: ${String(reason)}`
            })
    }

    const observer = new MutationObserver(activateIfVisible)
    observer.observe(element, {attributes: true, attributeFilter: ["hidden"]})
    lifecycle.own(Terminable.create(() => observer.disconnect()))
    lifecycle.own(Terminable.create(() => {
        if (dos !== null) {dos.stop().catch(() => {})}
    }))

    return element
}
