/** Management window loading is shared while each request retains its own cancellation. */
import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { DesktopPanels } from '../src/panels.ts'
function fixture() {
  const loaded = Promise.withResolvers<undefined>()
  let destroyed = false
  const window = { once: vi.fn(), loadURL: vi.fn(async () => { await loaded.promise }), isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true; loaded.reject(Error('closed')) }), isMinimized: () => false,
    restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
  const create = vi.fn(() => window as Partial<BrowserWindow> as BrowserWindow)
  return { loaded, window, create, panels: new DesktopPanels(create) }
}
it('coalesces concurrent normalized URLs, shows after load, and protects another live caller from cancellation', async () => {
  const f = fixture(), old = new AbortController()
  const first = f.panels.open('dsh-app://app/ui?workspace=a&locale=zh', old.signal)
  const rejected = expect(first).rejects.toThrow()
  const second = f.panels.open('dsh-app://app/ui?locale=zh&workspace=a')
  await Promise.resolve(undefined); old.abort()
  expect(f.create).toHaveBeenCalledOnce(); expect(f.window.show).not.toHaveBeenCalled()
  expect(f.window.destroy).not.toHaveBeenCalled()
  f.loaded.resolve(undefined); await rejected; await second
  expect(f.window.show).toHaveBeenCalledOnce()
  const later = new AbortController(), reuse = f.panels.open('dsh-app://app/ui?workspace=a&locale=zh', later.signal)
  later.abort(); await expect(reuse).rejects.toThrow()
  expect(f.window.destroy).not.toHaveBeenCalled()
  await f.panels.open('dsh-app://app/ui?workspace=a&locale=zh')
  expect(f.create).toHaveBeenCalledOnce()
  f.panels.dispose(); expect(f.window.destroy).toHaveBeenCalledOnce()
})
it('withdraws an unpresented window when its only request is cancelled', async () => {
  const f = fixture(), lifetime = new AbortController()
  const pending = f.panels.open('dsh-app://app/ui?tab=builds', lifetime.signal)
  lifetime.abort(); await expect(pending).rejects.toThrow()
  expect(f.window.destroy).toHaveBeenCalledOnce(); expect(f.window.show).not.toHaveBeenCalled()
})
it('keeps different workspace and tab addresses separate and destroys failed loads', async () => {
  const windows: ReturnType<typeof fixture>[] = []
  const registry = new DesktopPanels(() => {
    const f = fixture()
    windows.push(f)
    return f.window as Partial<BrowserWindow> as BrowserWindow
  })
  const one = registry.open('dsh-app://app/ui?workspace=a&tab=builds')
  const two = registry.open('dsh-app://app/ui?workspace=b&tab=builds')
  const three = registry.open('dsh-app://app/ui?workspace=a&tab=review')
  expect(windows).toHaveLength(3)
  const failed = expect(three).rejects.toThrow('load failed')
  windows[0]!.loaded.resolve(undefined); windows[1]!.loaded.resolve(undefined); windows[2]!.loaded.reject(Error('load failed'))
  await Promise.all([one, two, failed])
  expect(windows[2]!.window.destroy).toHaveBeenCalledOnce(); registry.dispose()
})
