/** Complete built Node-mode Host qualification, with synthetic keys and a local provider. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.runIf(process.platform === 'win32')('boots the current full Desktop profile through ready, keyless repair, proxy/CA restart, fatal and unload', async () => {
  const evidence = resolve('.build/dispatch/evidence/full-desktop-profile')
  await mkdir(evidence, { recursive: true })
  const root = await mkdtemp(evidence + '/run-')
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/connection-full-profile.mjs', import.meta.url)), root],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const output: string[] = []
  if (child.stdout === null || child.stderr === null) throw Error('Missing fixture output pipes')
  child.stdout.on('data', (chunk: Buffer) => { output.push(chunk.toString()) })
  child.stderr.on('data', (chunk: Buffer) => { output.push(chunk.toString()) })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => { resolve({ code, signal }) })
  })
  let timedOut = false
  const deadline = setTimeout(() => { timedOut = true; if (child.connected) child.send({ type: 'cancel' }) }, 90_000)
  try {
    const result = await done
    expect({ ...result, timedOut }, output.join('')).toEqual({ code: 0, signal: null, timedOut: false })
    expect(output.join('')).toContain('keyless-restart-real-agent-recording-valid-route')
    expect(output.join('')).toContain('deployment-save-pending-restart-real-proxy-loopback-bypass')
    expect(output.join('')).toContain('custom-ca-untrusted-rejected-launch-trust-local-tls-recorded')
    expect(output.join('')).toContain('bounded-import-explicit-adoption-cold-full-host-same-ledger')
    expect(output.join('')).toContain('committed-category-review-launch-preparation-separate-paused-plans')
    expect(output.join('')).toContain('authenticated-actual-shell-durable-receipt-stale-input-independent-acceptance')
    expect(output.join('')).toContain('durable-notice-single-claim-unknown-display-retained-source')
    expect(output.join('')).toContain('raw-durable-session-terminal-generation-reference-no-test-receipt')
    console.log('Full Desktop profile evidence: ' + root)
  } finally { clearTimeout(deadline); child.kill(); await done }
}, 100_000)
