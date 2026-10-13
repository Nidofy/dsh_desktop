/** Native window authority for plugin-owned pets; the Host owns model and Session state. */
import { app, BrowserWindow, ipcMain, net, screen } from 'electron'
import type { IpcMainInvokeEvent, Rectangle, Point } from 'electron'
interface PetWindow {
  window: BrowserWindow
  snapshot: Record<string, unknown>
  scale: number
  bubble: number
  menuOpen: boolean
  menuOffset: number
  fresh: boolean
  settingsKey?: string
  stateKey?: string
  stateAt?: number
  layoutKey?: string
  drag?: { point: Point
    bounds: Rectangle }
}
/** Dispose every optional window, timer and IPC handler when Desktop exits. */
export function installPetDesktop(preload: string, backend: () => { url: string; cookie: string }, focusMain: (sessionId: string) => void,
  admitCompanion?: (event: IpcMainInvokeEvent, scope: unknown) => AbortSignal): () => void {
  const windows = new Map<string, PetWindow>(), controller = new AbortController()
  let polling = false, nextPollAt = 0
  const scaleOf = (value: unknown): number => typeof value === 'number' && [0.75, 1, 1.25, 1.5].includes(value) ? value : 1
  function expire(row: PetWindow): void {
    delete row.drag
    row.menuOpen = false
    row.fresh = false; row.snapshot = { settings: row.snapshot.settings, state: { generation: '', items: [], disconnected: true } }
    delete row.stateKey
    if (!row.window.isDestroyed()) {
      row.window.setFocusable(false); resize(row)
      row.window.webContents.send('nidofy:pet-event', 'pet-state', row.snapshot.state)
    }
  }
  async function rpc(method: string, body: object = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const host = backend(), url = new URL('/api/nidofy-extras/' + method, host.url)
    const response = await net.fetch(url.toString(), { method: 'POST', headers: { origin: url.origin, cookie: host.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000), ...signal ? [signal] : []]) })
    if (!response.ok) throw Error('PET_PLUGIN_UNAVAILABLE')
    const value: unknown = await response.json()
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('PET_INVALID_STATE')
    return value as Record<string, unknown>
  }
  function close(id: string): void { const row = windows.get(id); windows.delete(id); row?.window.destroy() }
  async function suppressTerminalBubbles(): Promise<boolean> {
    const host = backend(), url = new URL('/api/nidofy/workbench/notifications/preferences', host.url)
    try {
      const response = await net.fetch(url.toString(), { method: 'POST', headers: { origin: url.origin,
        cookie: host.cookie, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })
      if (response.status === 404) return false
      if (!response.ok) return true
      const value: unknown = await response.json()
      return !value || typeof value !== 'object' || !('enabled' in value) || value.enabled !== false
    } catch (error) { void error; return true }
  }
  function admit(event: IpcMainInvokeEvent): [string, PetWindow] {
    for (const [id, row] of windows) {
      if (event.sender === row.window.webContents && event.senderFrame === event.sender.mainFrame
        && event.senderFrame.url.startsWith('dsh-app://app/api/nidofy-extras/assets/pet/')) return [id, row]
    }
    throw Error('PET_SENDER_REFUSED')
  }
  function place(bounds: Rectangle): Rectangle {
    const area = screen.getDisplayMatching(bounds).workArea
    return { ...bounds, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
      y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)) }
  }
  function resize(row: PetWindow): void {
    if (row.drag) return
    const current = row.window.getBounds(), width = Math.ceil(240 * row.scale)
    const pet = place({ x: current.x + row.menuOffset, y: current.y,
      width, height: Math.ceil((208 + row.bubble) * row.scale) })
    const area = screen.getDisplayMatching(pet).workArea
    const left = row.menuOpen && area.x + area.width - pet.x - width < 220
    row.menuOffset = left ? 220 : 0
    const bounds = place({ ...pet, x: pet.x - row.menuOffset,
      width: width + (row.menuOpen ? 220 : 0), height: row.menuOpen ? Math.max(208, pet.height) : pet.height })
    if (bounds.x !== current.x || bounds.y !== current.y || bounds.width !== current.width || bounds.height !== current.height)
      row.window.setBounds(bounds)
    const layout = { open: row.menuOpen, side: left ? 'left' : 'right', width }, key = JSON.stringify(layout)
    if (key !== row.layoutKey) { row.layoutKey = key; row.window.webContents.send('nidofy:pet-event', 'pet-layout', layout) }
  }
  async function poll(): Promise<void> {
    if (controller.signal.aborted || polling) return
    polling = true
    try {
      const state = await rpc('status'), p = state.preferences as Record<string, unknown> | undefined
      controller.signal.throwIfAborted()
      const companions: unknown[] = Array.isArray(p?.companions) ? p.companions : []
      const instances = p?.pets && (state.features as Record<string, unknown>).pets === 'ENABLED'
        ? [p.pet, ...companions].slice(0, 3) as Array<Record<string, unknown>> : []
      const active = new Set(instances.filter(p => p.enabled !== false).map(p => String(p.id)))
      const suppressNotice = instances.length > 0 && await suppressTerminalBubbles()
      for (const id of windows.keys()) if (!active.has(id)) close(id)
      for (const [index, settings] of instances.entries()) {
        const id = String(settings.id)
        if (!active.has(id)) continue
        const snapshot = await rpc('pet/snapshot', { id })
        const state = snapshot.state as { items?: Record<string, unknown>[] }
        if (Array.isArray(state.items)) state.items = state.items.map(item => ({ ...item,
          suppressNotice: suppressNotice && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(item.status)) }))
        controller.signal.throwIfAborted()
        let row = windows.get(id)
        if (!row) {
          const area = screen.getPrimaryDisplay().workArea, position = settings.position as Point | null
          const bounds = place({ x: position?.x ?? area.x + area.width - 260 * (index + 1),
            y: position?.y ?? area.y + area.height - 260, width: 240, height: 208 })
          const window = new BrowserWindow({ ...bounds, frame: false, transparent: true, show: false,
            alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false,
            webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } })
          row = { window, snapshot, scale: scaleOf(settings.scale), bubble: 0, menuOpen: false, menuOffset: 0, fresh: true }
          windows.set(id, row)
          window.setIgnoreMouseEvents(true, { forward: true })
          window.on('blur', () => {
            const current = windows.get(id)
            if (current?.window === window && current.menuOpen && !window.isDestroyed()) {
              current.menuOpen = false; window.setFocusable(false); resize(current)
            }
          })
          window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
          window.webContents.on('will-navigate', (event) =>{  event.preventDefault() })
          window.on('closed', () => { if (windows.get(id)?.window === window) windows.delete(id) })
          try { await window.loadURL('dsh-app://app/api/nidofy-extras/assets/pet/index.html?id=' + encodeURIComponent(id)) }
          catch (error) { close(id); throw error }
        }
        controller.signal.throwIfAborted()
        if (row.window.isDestroyed()) continue
        row.snapshot = snapshot; row.fresh = true; row.scale = scaleOf(settings.scale); resize(row)
        const settingsKey = JSON.stringify(snapshot.settings), stateKey = JSON.stringify(snapshot.state)
        if (settingsKey !== row.settingsKey) { row.settingsKey = settingsKey; row.window.webContents.send('nidofy:pet-event', 'pet-settings', snapshot.settings) }
        // A lightweight state heartbeat keeps the renderer's six-second stale fence meaningful.
        if (stateKey !== row.stateKey || Date.now() - (row.stateAt ?? 0) >= 3000) {
          row.stateKey = stateKey; row.stateAt = Date.now(); row.window.webContents.send('nidofy:pet-event', 'pet-state', snapshot.state)
        }
      }
      nextPollAt = Date.now() + (instances.length === 0 ? 10_000 : 1500)
    } catch { for (const row of windows.values()) expire(row); nextPollAt = Date.now() + 5000 } finally { polling = false }
  }
  ipcMain.handle('nidofy:pet', async (event, method: unknown, input: unknown) => {
    const [id, row] = admit(event)
    if (method === 'pet_snapshot') return row.snapshot
    if (method === 'pet_resource') return rpc('pet/resource', { id })
    const data = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {}
    if (method === 'pet_ready') { if (data.decoded === true || data.degraded === true) row.window.showInactive(); return }
    if (method !== 'pet_action' || typeof data.action !== 'string') throw Error('PET_ACTION_REFUSED')
    const target = data.target !== null && typeof data.target === 'object' ? data.target as Record<string, unknown> : {}
    if (data.action === 'menu') {
      if (typeof target.open !== 'boolean') throw Error('PET_MENU_REFUSED')
      row.menuOpen = target.open; row.window.setFocusable(target.open)
      if (target.open) { row.window.setIgnoreMouseEvents(false); row.window.focus() }
      resize(row); return
    }
    if (data.action === 'hit-test') {
      if (typeof target.interactive !== 'boolean') throw Error('PET_ACTION_REFUSED')
      row.window.setIgnoreMouseEvents(!target.interactive && !row.menuOpen && !row.drag, { forward: true }); return
    }
    if (data.action === 'bubble-size') {
      if (!Number.isInteger(target.height) || Number(target.height) < 0 || Number(target.height) > 160) throw Error('PET_BUBBLE_REFUSED')
      row.bubble = Number(target.height); resize(row); return
    }
    if (data.action === 'drag-end') {
      delete row.drag; resize(row)
      if (!row.fresh) return { saved: false }
      const { x, y } = row.window.getBounds(); return rpc('pet/update', { id, action: 'position', position: { x, y } })
    }
    if (!row.fresh) throw Error('PET_STATE_STALE')
    if (data.action === 'drag') {
      if (row.menuOpen) throw Error('PET_MENU_OPEN')
      const bounds = row.window.getBounds(), x = Number(target.x), y = Number(target.y)
      if (![x, y].every(v => Number.isFinite(v) && v >= 0 && v <= 4096)) throw Error('PET_DRAG_REFUSED')
      row.drag = { point: { x: bounds.x + x, y: bounds.y + y }, bounds }; return
    }
    if (data.action === 'drag-move' && row.drag) {
      const point = screen.getCursorScreenPoint()
      row.window.setBounds(place({ ...row.drag.bounds, x: row.drag.bounds.x + point.x - row.drag.point.x,
        y: row.drag.bounds.y + point.y - row.drag.point.y })); return
    }
    const state = row.snapshot.state as { generation?: string; items?: Array<{ sessionId?: string }> }
    if (['navigate', 'pin'].includes(data.action) && (target.generation !== state.generation || !state.items?.some(r => r.sessionId === target.sessionId))) throw Error('PET_TARGET_CHANGED')
    if (data.action === 'navigate' && typeof target.sessionId === 'string') { focusMain(target.sessionId); return { sessionId: target.sessionId } }
    if (['pin', 'unpin', 'hide', 'interact'].includes(data.action)) {
      await rpc('pet/update', { id, action: data.action, target })
      const snapshot = await rpc('pet/snapshot', { id })
      if (!row.window.isDestroyed()) {
        row.snapshot = snapshot; row.fresh = true
        row.window.webContents.send('nidofy:pet-event', 'pet-settings', snapshot.settings)
        row.window.webContents.send('nidofy:pet-event', 'pet-state', snapshot.state)
      }
      await poll(); return snapshot
    }
    throw Error('PET_ACTION_REFUSED')
  })
  ipcMain.handle('nidofy:pet-coordinate', async (event, scope: unknown, input: unknown) => {
    if (!admitCompanion) throw Error('PET_SENDER_REFUSED')
    const signal = admitCompanion(event, scope)
    if (!scope || typeof scope !== 'object' || !('sessionId' in scope) || typeof scope.sessionId !== 'string') throw Error('PET_TARGET_CHANGED')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('PET_COMMAND_INVALID')
    const command = input as Record<string, unknown>
    if (Object.keys(command).sort().join() !== 'action,actionId,expiry,target'
      && Object.keys(command).sort().join() !== 'action,actionId,expectedRevision,expiry,target') throw Error('PET_COMMAND_INVALID')
    signal.throwIfAborted()
    const status = await rpc('status'), preferences = status.preferences as Record<string, unknown>
    if ('expectedRevision' in command && command.expectedRevision !== preferences.revision) throw Error('PET_TARGET_CHANGED')
    const snapshot = await rpc('pet/snapshot', { id: command.target }), state = snapshot.state as Record<string, unknown>
    signal.throwIfAborted()
    const result = await rpc('pet/coordinate', { action: command.action, actionId: command.actionId, target: command.target,
      expiry: command.expiry, sessionId: scope.sessionId,
      scopeVersion: preferences.revision, generation: state.generation }, signal)
    signal.throwIfAborted()
    if (command.action === 'interact' && typeof command.target === 'string') {
      const row = windows.get(command.target)
      if (row && !row.window.isDestroyed()) row.window.webContents.send('nidofy:pet-event', 'pet-interaction', {
        actionId: command.actionId, sessionId: scope.sessionId, generation: state.generation, expiry: command.expiry })
    }
    await poll(); return result
  })
  const timer = setInterval(() => { if (Date.now() >= nextPollAt) void poll() }, 1500)
  const dispose = (): void => { controller.abort(); clearInterval(timer); for (const id of windows.keys()) close(id)
    ipcMain.removeHandler('nidofy:pet'); ipcMain.removeHandler('nidofy:pet-coordinate') }
  app.once('will-quit', dispose)
  return dispose
}
