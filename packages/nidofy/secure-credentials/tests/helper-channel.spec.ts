/** Real helper launch inspected at the process boundary; all payloads are synthetic. */
import { expect, it, vi } from 'vitest'
import { WindowsDpapiProtector } from '../src/dpapi.ts'
import type { SpawnOptions } from 'node:child_process'

const launched = vi.hoisted(() => ({ argv: [] as string[], environment: {} as NodeJS.ProcessEnv, hidden: false }))
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawn: (command: string, args: readonly string[], settings: SpawnOptions) => {
    launched.argv = [command, ...args]
    launched.environment = { ...settings.env }
    launched.hidden = settings.windowsHide === true
    return actual.spawn(command, args, settings)
  } }
})

it.skipIf(process.platform !== 'win32')('sends secrets only through pipes and scrubs the helper environment', async () => {
  const backend = new WindowsDpapiProtector(10000, 65536)
  const secret = Buffer.from('synthetic-astra-channel-secret'), entropy = Buffer.from('synthetic-astra-namespace')
  const encrypted = await backend.protect(secret, entropy)
  expect(await backend.unprotect(encrypted, entropy)).toEqual(secret)
  const argumentsText = launched.argv.join(' ')
  expect(argumentsText).not.toContain(secret.toString())
  expect(argumentsText).not.toContain(secret.toString('base64'))
  expect(argumentsText).not.toContain(entropy.toString('base64'))
  expect(launched.hidden).toBe(true)
  expect(Object.keys(launched.environment).sort()).toEqual(['SystemRoot', 'TEMP', 'TMP', 'windir'])
}, 30000)
