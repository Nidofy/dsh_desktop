/** Supported built Desktop profile with real protected Shell/T11/native quota, zero Agent and zero model sends. */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { closeSelftestCarrier } from './selftest-carrier-process.ts'

it.runIf(process.platform === 'win32')('reads and archives actual task receipts through the authenticated built profile without replay', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/experiments-full-profile.mjs', import.meta.url)),
    resolve('.build/dispatch/evidence/relay-22/full-profile')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const output: string[] = []
  child.stdout?.on('data', (bytes: Buffer) => { output.push(bytes.toString()) })
  child.stderr?.on('data', (bytes: Buffer) => { output.push(bytes.toString()) })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => { accept({ code, signal }) })
  })
  onTestFinished(() => closeSelftestCarrier(child, done))
  expect(await done, output.join('')).toEqual({ code: 0, signal: null })
  for (const behavior of ['supported-full-profile-authentication-origin-bilingual-page-zero-model-and-agent',
    'authenticated-model-step-desktop-source-unknown-no-retrospective-counts',
    'actual-protected-shell-two-tap-receipts-independent-acceptance-quota-archive-import-refusal',
    'cold-restart-read-original-record-bytes-source-change-no-replay']) expect(output.join('')).toContain(behavior)
  console.log(output.join(''))
}, 180000)
