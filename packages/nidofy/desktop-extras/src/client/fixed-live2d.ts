/** Fixed offline Bluewhale resource loader; an authorized Web SDK adapter owns all Core and GPU calls. */
import { OfflineScriptOwner } from './offline-script.ts'
const base = '/api/nidofy-extras/assets/companion/bluewhale/live2d/'
const files = ['bluewhale.model3.json', 'bluewhale.moc3', 'bluewhale.2048/texture_00.png', 'bluewhale.cdi3.json', 'motions/idle.motion3.json'] as const
/** Exact offline bytes; source projects and unsupported motions are never loaded. */
export interface BluewhaleResources { model: Uint8Array; moc: Uint8Array; texture: Uint8Array; display: Uint8Array; idle: Uint8Array }
/** An SDK adapter must release its model, textures, shader resources and WebGL ownership on dispose. */
export interface Live2dRenderer { draw(timeSeconds: number, state: 'idle' | 'working' | 'waiting' | 'disconnected'): void; dispose(): void }
/** Authorized Core/Framework adapter; it receives no Session, credentials, execution or connection services. */
export type Live2dFactory = (canvas: HTMLCanvasElement, resources: BluewhaleResources, signal: AbortSignal) => Promise<Live2dRenderer>
const core = new OfflineScriptOwner(base + 'live2dcubismcore.min.js')
/** @param signal - Current display operation. @returns The fixed offline SDK factory; cancelled consumers never create a renderer. */
export async function loadBluewhaleSdk(signal: AbortSignal): Promise<Live2dFactory> {
  signal.throwIfAborted()
  await core.acquire(signal); signal.throwIfAborted()
  const path = base + 'bluewhale-sdk.mjs'
  const module: unknown = await import(/* @vite-ignore */ path)
  if (!module || typeof module !== 'object' || !('createRenderer' in module) || typeof module.createRenderer !== 'function') throw Error('LIVE2D_WEB_SDK_UNAVAILABLE')
  signal.throwIfAborted()
  return module.createRenderer as Live2dFactory
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('LIVE2D_RESOURCE_INVALID')
  return value as Record<string, unknown>
}
async function bytes(path: typeof files[number], signal: AbortSignal): Promise<Uint8Array> {
  const limit = path.endsWith('.png') ? 16 * 1024 * 1024 : path.endsWith('.moc3') ? 8 * 1024 * 1024 : 64 * 1024
  const response = await fetch(base + path, { signal, redirect: 'error' })
  if (!response.ok || !response.body) throw Error('LIVE2D_RESOURCE_UNAVAILABLE')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const row = await reader.read()
      if (row.done) break
      size += row.value.byteLength; if (size > limit) throw Error('LIVE2D_RESOURCE_LIMIT')
      chunks.push(row.value)
    }
  } finally { try { await reader.cancel() } finally { reader.releaseLock() } }
  signal.throwIfAborted()
  const result = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  if (!size) throw Error('LIVE2D_RESOURCE_INVALID')
  return result
}
/** Load the exact fixed resource closure, refusing arbitrary paths and extra references.
 * @param signal - Loading lifetime. @returns Validated model bytes.
 */
export async function loadBluewhale(signal: AbortSignal): Promise<BluewhaleResources> {
  const model = await bytes(files[0], signal), value = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(model)))
  const refs = record(value.FileReferences), motions = record(refs.Motions)
  if (value.Version !== 3 || Object.keys(refs).sort().join() !== 'DisplayInfo,Moc,Motions,Textures'
    || refs.Moc !== files[1] || refs.DisplayInfo !== files[3] || JSON.stringify(refs.Textures) !== JSON.stringify([files[2]])
    || Object.keys(motions).join() !== 'Idle' || !Array.isArray(motions.Idle) || motions.Idle.length !== 1
    || record(motions.Idle[0]).File !== files[4]
    || Object.keys(record(motions.Idle[0])).some(key => !['File', 'FadeInTime', 'FadeOutTime'].includes(key))) throw Error('LIVE2D_REFERENCE_REFUSED')
  const [moc, texture, display, idle] = await Promise.all(files.slice(1).map(path => bytes(path, signal)))
  if (!moc || !texture || !display || !idle || new TextDecoder().decode(moc.slice(0, 4)) !== 'MOC3') throw Error('LIVE2D_RESOURCE_INVALID')
  record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(display)))
  const motion = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(idle)))
  if (motion.Version !== 3 || !Array.isArray(motion.Curves) || motion.Curves.length !== 1
    || record(motion.Curves[0]).Id !== 'ParamBodySway') throw Error('LIVE2D_MOTION_REFUSED')
  return { model, moc, texture, display, idle }
}
/** One cancellable display operation caps drawing at 30FPS and drains every late renderer before replacement. */
export class FixedLive2dController {
  constructor(private readonly unavailable: (reason: unknown) => void = () => {}) {}
  private active: {
    abort: AbortController
    frame: number | null
    renderer: Live2dRenderer | null
    done: Promise<void>
    remove(): void
  } | null = null
  private state: Parameters<Live2dRenderer['draw']>[1] = 'idle'
  /** @param state - Semantic display status; missing actions remain idle in the fixed SDK adapter. */
  status(state: Parameters<Live2dRenderer['draw']>[1]): void { this.state = state }
  /** @param canvas - Caller-owned canvas. @param factory - Authorized offline SDK adapter.
   * @returns Loading completion or explicit fallback failure.
   */
  async start(canvas: HTMLCanvasElement, factory?: Live2dFactory): Promise<void> {
    const draining = this.stop()
    const abort = new AbortController(), operation = { abort, frame: null as number | null, renderer: null as Live2dRenderer | null,
      done: Promise.resolve(), remove: () => {} }
    this.active = operation
    operation.done = (async () => {
      await draining; abort.signal.throwIfAborted()
      const resources = await loadBluewhale(abort.signal)
      if (!factory) throw Error('LIVE2D_WEB_SDK_UNAVAILABLE')
      const renderer = await factory(canvas, resources, abort.signal)
      if (abort.signal.aborted) { renderer.dispose(); abort.signal.throwIfAborted() }
      operation.renderer = renderer
      const lost = (event: Event): void => { event.preventDefault(); this.unavailable(Error('LIVE2D_CONTEXT_LOST')); void this.stop() }
      canvas.addEventListener('webglcontextlost', lost)
      operation.remove = () =>{  canvas.removeEventListener('webglcontextlost', lost) }
      let previous = -Infinity
      const draw = (time: number): void => {
        if (abort.signal.aborted) return
        if (time - previous >= 1000 / 30) {
          try { renderer.draw(time / 1000, this.state); previous = time }
          catch (error) { this.unavailable(error); void this.stop(); return }
        }
        operation.frame = requestAnimationFrame(draw)
      }
      operation.frame = requestAnimationFrame(draw)
    })()
    try { await operation.done }
    catch (error) { if (this.active === operation) await this.stop(); throw error }
  }
  /** Cancel pending bytes and RAF, then release textures/models even when a factory ignores cancellation. */
  async stop(): Promise<void> {
    const operation = this.active; this.active = null
    if (!operation) return
    operation.abort.abort(); if (operation.frame !== null) cancelAnimationFrame(operation.frame)
    await operation.done.catch(() => { /* Caller receives load failures; cleanup still owns late resources. */ })
    operation.remove(); operation.renderer?.dispose(); operation.renderer = null
  }
}
