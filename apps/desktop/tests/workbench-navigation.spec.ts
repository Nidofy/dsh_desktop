/** Existing-session navigation checks the authenticated owner and never resumes work. */
import { afterEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { installWorkbenchDesktop } from '../src/workbench.ts'
import { en } from '../src/locale.ts'
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: never[]) => unknown>(), fetch: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: never[]) => unknown) => mocks.handlers.set(name, fn),
    removeHandler: (name: string) => mocks.handlers.delete(name) },
  net: { fetch: mocks.fetch }, dialog: {}, shell: {}, Notification: { isSupported: () => false },
}))
afterEach(() => { mocks.handlers.clear(); vi.clearAllMocks() })
it('refuses missing sessions and admits only a read-confirmed exact session ID', async () => {
  const admit = vi.fn(), navigate = vi.fn()
  const close = installWorkbenchDesktop(admit, () => ({ url: 'http://127.0.0.1:1234', cookie: 'synthetic' }), () => en, async () => {}, navigate)
  try {
    const invoke = mocks.handlers.get('nidofy:open-session')! as (event: IpcMainInvokeEvent, id: unknown) => Promise<void>
    const event = {} as IpcMainInvokeEvent
    await expect(invoke(event, '../bad')).rejects.toThrow('SESSION_ID_INVALID')
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    await expect(invoke(event, 'missing')).rejects.toThrow()
    expect(navigate).not.toHaveBeenCalled()
    mocks.fetch.mockResolvedValueOnce(new Response('{}'))
    await invoke(event, 'existing-session')
    expect(navigate).toHaveBeenCalledExactlyOnceWith('existing-session')
    expect(admit).toHaveBeenCalledTimes(3)
    expect(mocks.fetch.mock.calls.every(([url]) => String(url).endsWith('/workbench/recovery'))).toBe(true)
  } finally { await close() }
  expect(mocks.handlers.has('nidofy:open-session')).toBe(false)
})
