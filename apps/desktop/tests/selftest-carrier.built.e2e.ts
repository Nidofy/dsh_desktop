/** Actual Electron T19 UI with production Main/preload and no user Session or billed provider. */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { closeSelftestCarrier } from './selftest-carrier-process.ts'

it.runIf(process.platform === 'win32')('runs the authenticated bilingual local self-test in a private real Electron carrier', async () => {
  const evidence = resolve('.build/dispatch/evidence/relay-20/renderer-local')
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/selftest-carrier.mjs', import.meta.url)), evidence],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const output: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => { output.push(chunk.toString()) })
  child.stderr?.on('data', (chunk: Buffer) => { output.push(chunk.toString()) })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { accept({ code, signal }) })
  })
  onTestFinished(() => closeSelftestCarrier(child, done))
  const result = await done
  expect(result, output.join('')).toEqual({ code: 0, signal: null })
  for (const behavior of [
    'production-main-sandboxed-preload-built-client-local-protocol-and-unauthenticated-http-refusal',
    'personal-extensions-selftest-navigation-auxiliary-preload-and-conversation-bootstrap-refusal',
    'bilingual-real-renderer-capacity-read-zero-allocation-preparation-model-and-agent',
    'actual-renderer-single-explicit-local-run-native-quota-and-node-mode-report-field-unknown',
    'bilingual-report-reload-history-export-original-bytes-retained-zero-replay',
    'real-chromium-json-markdown-downloads-whitelist-and-no-report-write',
    'auxiliary-close-keeps-owned-root-and-committed-report-zero-model-or-agent',
  ]) expect(output.join('')).toContain(behavior)
  console.log(output.join(''))
}, 180_000)
