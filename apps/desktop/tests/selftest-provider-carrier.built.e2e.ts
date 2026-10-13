/** Actual Electron fixed-budget confirmation and SSE cancellation; only a synthetic loopback provider. */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { closeSelftestCarrier } from './selftest-carrier-process.ts'

it.runIf(process.platform === 'win32')('confirms and cancels fixed connection checks in the real private Electron dashboard', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/selftest-carrier.mjs', import.meta.url)),
    resolve('.build/dispatch/evidence/relay-20/renderer-provider'), 'provider'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const output: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => { output.push(chunk.toString()) })
  child.stderr?.on('data', (chunk: Buffer) => { output.push(chunk.toString()) })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { accept({ code, signal }) })
  })
  onTestFinished(() => closeSelftestCarrier(child, done))
  expect(await done, output.join('')).toEqual({ code: 0, signal: null })
  for (const behavior of [
    'actual-bilingual-fixed-route-revisions-budget-preview-unchecked-consent-and-budget-change-discard-zero-send',
    'actual-renderer-five-fixed-64-token-sse-sends-private-inputs-capacity-whitelist-readonly-reload-zero-agent',
    'actual-renderer-cancel-started-sse-drain-six-total-sends-no-retry-reload-or-resume',
    'official-six-private-inputs-cold-reconstruct-exact-wire-text-and-output-cap-zero-agent',
  ]) expect(output.join('')).toContain(behavior)
  console.log(output.join(''))
}, 180_000)
