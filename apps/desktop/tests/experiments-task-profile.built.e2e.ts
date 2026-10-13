/** Current full Desktop Host profile and isolated synthetic task HTTP; no Agent, project command or paid endpoint. */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { closeSelftestCarrier } from './selftest-carrier-process.ts'

it.runIf(process.platform === 'win32')('confirms independent task inputs and drains or cold-reads their journals through the authenticated built profile', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/experiments-full-profile.mjs', import.meta.url)),
    resolve('.build/dispatch/evidence/relay-24/full-profile'), 'task'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const output: string[] = []
  child.stdout?.on('data', (bytes: Buffer) => { output.push(bytes.toString()) })
  child.stderr?.on('data', (bytes: Buffer) => { output.push(bytes.toString()) })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => { accept({ code, signal }) })
  })
  onTestFinished(() => closeSelftestCarrier(child, done))
  expect(await done, output.join('')).toEqual({ code: 0, signal: null })
  for (const behavior of ['authenticated-task-single-confirmation-official-input-native-quota-bilingual-zero-agent',
    'task-cancel-drains-synthetic-provider-no-retry', 'failed-task-no-retry-no-failover-no-tools',
    'cold-task-restart-original-bytes-orphan-unknown-no-replay']) expect(output.join('')).toContain(behavior)
  console.log(output.join(''))
}, 180000)
