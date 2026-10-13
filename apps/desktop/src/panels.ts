/** Reuse one management window per complete URL; each caller owns only its pending request. */
import type { BrowserWindow } from 'electron'
interface Panel { window: BrowserWindow; ready: Promise<void>; claims: Set<symbol>; presented: boolean }
export class DesktopPanels {
  private readonly panels = new Map<string, Panel>()
  constructor(private readonly create: () => BrowserWindow) {}
  /** Load a hidden window once and focus it only while this request remains current.
   * @param address - Complete app URL, including workspace, locale and selected tab.
   * @param signal - Optional request scope; cancellation never destroys an already presented window.
   */
  async open(address: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const url = new URL(address); url.searchParams.sort()
    const key = url.href
    let row = this.panels.get(key)
    if (row?.window.isDestroyed()) { this.panels.delete(key); row = undefined }
    if (!row) {
      const window = this.create()
      row = { window, ready: Promise.resolve(), claims: new Set(), presented: false }
      const created = row
      this.panels.set(key, created)
      const forget = () => { if (this.panels.get(key) === created) this.panels.delete(key) }
      window.once('closed', forget)
      created.ready = Promise.resolve().then(async () => { await window.loadURL(key) }).catch((error: unknown) => {
        forget(); if (!window.isDestroyed()) window.destroy(); throw error
      })
    }
    const target = row, claim = Symbol()
    target.claims.add(claim)
    const release = () => {
      target.claims.delete(claim)
      if (!target.presented && target.claims.size === 0) {
        if (this.panels.get(key) === target) this.panels.delete(key)
        if (!target.window.isDestroyed()) target.window.destroy()
      }
    }
    signal?.addEventListener('abort', release, { once: true })
    try {
      await target.ready
      signal?.throwIfAborted()
      if (target.window.isDestroyed()) throw Error('PANEL_CLOSED')
      target.presented = true
      if (target.window.isMinimized()) target.window.restore()
      target.window.show(); target.window.focus()
    } finally { signal?.removeEventListener('abort', release); release() }
  }
  /** Destroy windows owned by the registry during application shutdown. */
  dispose(): void {
    for (const { window } of this.panels.values()) if (!window.isDestroyed()) window.destroy()
    this.panels.clear()
  }
}
