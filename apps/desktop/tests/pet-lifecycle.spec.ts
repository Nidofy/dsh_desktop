/** Native pet lifecycle against isolated Electron doubles; no real window or Host data is accessed. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), windows: [] as FakeWindow[],
  fail: false, scale: 1, loadFail: false, focusMain: vi.fn(), fetch: vi.fn() }))
class FakeWindow {
  destroyed = false
  listeners = new Map<string, () => void>()
  bounds: { x: number; y: number; width: number; height: number }
  webContents = { mainFrame: { url: 'dsh-app://app/api/nidofy-extras/assets/pet/index.html' },
    send: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() }
  setBounds = vi.fn((value: typeof this.bounds) => { this.bounds = value })
  setFocusable = vi.fn()
  setIgnoreMouseEvents = vi.fn()
  showInactive = vi.fn()
  focus = vi.fn()
  constructor(readonly options: Record<string, unknown>) {
    this.bounds = { x: Number(options.x), y: Number(options.y), width: Number(options.width), height: Number(options.height) }
    host.windows.push(this)
  }
  getBounds() { return this.bounds }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true }
  on(name: string, listener: () => void) { this.listeners.set(name, listener) }
  async loadURL() { if (host.loadFail) throw Error('SYNTHETIC_LOAD_FAILURE') }
}
vi.mock('electron', () => ({ app: { once: vi.fn() }, BrowserWindow: FakeWindow,
  ipcMain: { handle: (name: string, listener: (...args: unknown[]) => Promise<unknown>) => host.handlers.set(name, listener),
    removeHandler: (name: string) => host.handlers.delete(name) },
  net: { fetch: host.fetch }, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) } }))
const { installPetDesktop } = await import('../src/pet.ts')
let dispose: () => void
beforeEach(() => {
  vi.useFakeTimers(); host.fail = false; host.loadFail = false; host.scale = 1; host.windows.length = 0; host.focusMain.mockClear()
  host.fetch.mockImplementation(async (url: string) => {
    if (host.fail) throw Error('SYNTHETIC_DISCONNECTED')
    if (url.endsWith('/preferences')) return Response.json({ enabled: false })
    const settings = { id: 'one', scale: host.scale, enabled: true }
    return Response.json(url.endsWith('/status') ? { preferences: { pets: true, pet: settings, companions: [] }, features: { pets: 'ENABLED' } }
      : { settings, state: { generation: 'generation', items: [{ sessionId: 'session', status: 'RUNNING' }] } })
  })
  dispose = installPetDesktop('isolated-preload', () => ({ url: 'http://127.0.0.1', cookie: 'synthetic' }), host.focusMain)
})
afterEach(() => { dispose(); vi.useRealTimers() })
function invoke(action: string, target: object = {}) {
  const window = host.windows.at(-1)!
  return host.handlers.get('nidofy:pet')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame },
    'pet_action', { action, target })
}
it('clamps invalid scale and avoids unchanged bounds/settings writes while retaining its state heartbeat', async () => {
  host.scale = Number.NaN
  await vi.advanceTimersByTimeAsync(1500)
  const window = host.windows[0]!
  expect(window.bounds.width).toBe(240); expect(window.options.focusable).toBe(false)
  window.setBounds.mockClear(); window.webContents.send.mockClear()
  await vi.advanceTimersByTimeAsync(1500)
  expect(window.setBounds).not.toHaveBeenCalled()
  expect(window.webContents.send).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1500)
  expect(window.webContents.send).toHaveBeenCalledWith('nidofy:pet-event', 'pet-state', expect.any(Object))
})
it('retains a disconnected pet but rejects stale navigation and interaction, then recovers on a fresh snapshot', async () => {
  await vi.advanceTimersByTimeAsync(1500)
  const window = host.windows[0]!
  host.fail = true; await vi.advanceTimersByTimeAsync(1500)
  expect(window.destroyed).toBe(false)
  expect(window.webContents.send).toHaveBeenCalledWith('nidofy:pet-event', 'pet-state', expect.objectContaining({ disconnected: true, items: [] }))
  await expect(invoke('navigate', { generation: 'generation', sessionId: 'session' })).rejects.toThrow('PET_STATE_STALE')
  await expect(invoke('interact')).rejects.toThrow('PET_STATE_STALE')
  expect(host.focusMain).not.toHaveBeenCalled()
  host.fail = false; await vi.advanceTimersByTimeAsync(6000)
  await invoke('navigate', { generation: 'generation', sessionId: 'session' })
  expect(host.focusMain).toHaveBeenCalledWith('session'); expect(host.windows).toHaveLength(1)
})
it('grants focus only to an explicit menu and restores nonfocusable mode on blur', async () => {
  await vi.advanceTimersByTimeAsync(1500)
  const window = host.windows[0]!
  await invoke('menu', { open: true })
  expect(window.setFocusable).toHaveBeenLastCalledWith(true); expect(window.focus).toHaveBeenCalledOnce()
  window.listeners.get('blur')!()
  expect(window.setFocusable).toHaveBeenLastCalledWith(false)
  await invoke('hit-test', { interactive: false })
  expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
})

it('cleans up a mid-drag disconnect without persisting stale coordinates', async () => {
  await vi.advanceTimersByTimeAsync(1500)
  const window = host.windows[0]!
  await invoke('drag', { x: 10, y: 10 })
  host.fail = true; await vi.advanceTimersByTimeAsync(1500)
  host.fetch.mockClear()
  await expect(invoke('drag-end')).resolves.toEqual({ saved: false })
  expect(host.fetch).not.toHaveBeenCalled()
  await invoke('hit-test', { interactive: false })
  expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  await invoke('bubble-size', { height: 40 })
  expect(window.bounds.height).toBe(248)
})

it('removes a failed initial document and retries a new window after bounded backoff', async () => {
  host.loadFail = true; await vi.advanceTimersByTimeAsync(1500)
  expect(host.windows[0]!.destroyed).toBe(true)
  host.loadFail = false; await vi.advanceTimersByTimeAsync(6000)
  expect(host.windows).toHaveLength(2); expect(host.windows[1]!.destroyed).toBe(false)
})
