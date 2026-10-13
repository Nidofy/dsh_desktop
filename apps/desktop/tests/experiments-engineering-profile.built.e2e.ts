/** Current supported Node-mode Desktop Host executes an actual synthetic-provider Agent over a fresh isolated copy. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
it.runIf(process.platform === 'win32')('records full inputs and the actual protected action receipt, drains cancellation and cold-reads without resend', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/experiments-full-profile.mjs', import.meta.url)),
    resolve('.build/dispatch/evidence/relay-27/current-profile'), 'engineering'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let output = ''
  child.stdout?.on('data', (bytes) => { output += String(bytes) }); child.stderr?.on('data', (bytes) => { output += String(bytes) })
  const timeout = setTimeout(() => { child.send({ type: 'cancel' }); child.kill() }, 90000)
  try {
    const code = await new Promise<number | null>((accept, reject) => { child.once('error', reject); child.once('exit', accept) })
    expect(code, output).toBe(0)
  } finally { clearTimeout(timeout); if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('close', resolve)) } }
}, 95000)
