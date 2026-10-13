import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { distributionPaths } from '../src/distribution.ts'
import { distributionDataRoot, distributionPortable, registerDesktopProtocol, type DesktopProtocolApplication } from '../src/distribution-protocol.ts'

it('requires an explicit private data root for portable qualification and rejects ambiguous options', () => {
  const flag = '--nidofy-desktop-portable'
  expect(distributionPortable([], undefined, false)).toBe(false)
  expect(distributionPortable([flag], resolve('portable'), true)).toBe(true)
  expect(() => distributionPortable([flag], undefined, true)).toThrow('explicit absolute')
  expect(() => distributionPortable([flag], 'relative', true)).toThrow('explicit absolute')
  expect(() => distributionPortable([flag], resolve('portable'), false)).toThrow('private distribution')
  expect(() => distributionPortable([flag, flag], resolve('portable'), true)).toThrow('invalid portable')
  expect(() => distributionPortable([`${flag}=false`], resolve('portable'), true)).toThrow('invalid portable')
})

it('returns a browser protocol launch without the launcher environment to the same profile', () => {
  const root = resolve('trial profile/中文')
  const application = { setAsDefaultProtocolClient: vi.fn<DesktopProtocolApplication['setAsDefaultProtocolClient']>(() => true) }
  expect(registerDesktopProtocol(application, 'dsh', root, 'desktop.exe', 'win32')).toBe(true)
  const args = application.setAsDefaultProtocolClient.mock.calls[0]!
  expect(args.slice(0, 2)).toEqual(['dsh', 'desktop.exe'])
  const returnedRoot = distributionDataRoot(['desktop.exe', ...args[2]!, 'dsh://open'])
  expect(distributionPaths(resolve('app-data'), returnedRoot)).toEqual(distributionPaths(resolve('app-data'), root))
  expect(distributionDataRoot(args[2]!, resolve('another profile'))).toBe(root)
})

it('preserves ordinary launcher roots and keeps separate profiles separate', () => {
  expect(distributionDataRoot(['desktop.exe', 'dsh://open'])).toBeUndefined()
  expect(distributionDataRoot([], resolve('trial'))).toBe(resolve('trial'))
  expect(distributionPaths(resolve('app-data'), resolve('one'))).not.toEqual(distributionPaths(resolve('app-data'), resolve('two')))
  expect(() => distributionDataRoot(['--nidofy-desktop-data-root=relative'])).toThrow('absolute')
  expect(() => distributionDataRoot(['--nidofy-desktop-data-root='])).toThrow('absolute')
  expect(() => distributionDataRoot([`--nidofy-desktop-data-root=${resolve('one')}`, `--nidofy-desktop-data-root=${resolve('two')}`])).toThrow('duplicate')
})

it('registers private schemes separately and leaves official and macOS launch conventions intact', () => {
  const application = { setAsDefaultProtocolClient: vi.fn(() => false) }
  expect(registerDesktopProtocol(application, 'nidofy-dsh', resolve('trial'), 'desktop.exe', 'win32')).toBe(false)
  expect(application.setAsDefaultProtocolClient).toHaveBeenLastCalledWith('nidofy-dsh', 'desktop.exe', [`--nidofy-desktop-data-root=${resolve('trial')}`])
  registerDesktopProtocol(application, 'dsh', undefined, 'desktop.exe', 'win32')
  expect(application.setAsDefaultProtocolClient).toHaveBeenLastCalledWith('dsh')
  registerDesktopProtocol(application, 'nidofy-dsh', resolve('trial'), 'desktop', 'darwin')
  expect(application.setAsDefaultProtocolClient).toHaveBeenLastCalledWith('nidofy-dsh')
})
