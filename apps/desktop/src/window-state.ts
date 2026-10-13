/** Remember the main window's normal rectangle and clamp it to current display work areas. */
import { readFileSync, writeFileSync } from 'node:fs'
import type { BrowserWindow, Rectangle } from 'electron'
export interface DesktopWindowState { bounds: Rectangle; maximized: boolean }
/** Clamp dimensions and position without assuming the old monitor still exists.
 * @param bounds - Requested window rectangle in display-independent pixels.
 * @param area - Current display work area.
 * @returns A fully visible rectangle.
 */
export function fitWindowBounds(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(Math.max(520, bounds.width), area.width), height = Math.min(Math.max(600, bounds.height), area.height)
  return { width: Math.round(width), height: Math.round(height),
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))) }
}
/** Read only this shell's optional geometry file; invalid or absent data starts with defaults.
 * @param path - Shell-owned userData geometry file.
 * @returns Valid saved geometry, when available.
 */
export function readWindowState(path: string): DesktopWindowState | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object' || !('bounds' in value) || !('maximized' in value)
      || typeof value.maximized !== 'boolean' || !value.bounds || typeof value.bounds !== 'object') return
    const bounds = value.bounds
    if (!('x' in bounds) || !('y' in bounds) || !('width' in bounds) || !('height' in bounds)) return
    const { x, y, width, height } = bounds
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
      || ![x, y, width, height].every(value => Number.isSafeInteger(value) && Math.abs(value) <= 2147483647)
      || width <= 0 || height <= 0) return
    return { bounds: { x, y, width, height }, maximized: value.maximized }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) console.warn('Desktop window geometry unavailable', error)
    return undefined
  }
}
/** Persist normal bounds on explicit close or tray hide, without storing renderer data.
 * @param window - Main window owned by the shell.
 * @param path - Shell-owned userData geometry file.
 */
export function rememberWindowState(window: BrowserWindow, path: string): void {
  const save = () => {
    if (window.isDestroyed()) return
    try { writeFileSync(path, JSON.stringify({ bounds: window.getNormalBounds(), maximized: window.isMaximized() })) }
    catch (error) { console.warn('Desktop window geometry could not be saved', error) }
  }
  window.on('close', save); window.on('hide', save)
}
