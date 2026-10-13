/** A real broad-policy supported Host refuses engineering confirmation before any Agent, provider request or action exists. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
it.runIf(process.platform === 'win32')('refuses full-access engineering preparation without changing source or creating work', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/experiments-full-profile.mjs', import.meta.url)),
    resolve('.build/dispatch/evidence/relay-26/sandbox-profile'), 'engineering-refusal'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let output = ''
  child.stdout?.on('data', (bytes) => { output += String(bytes) }); child.stderr?.on('data', (bytes) => { output += String(bytes) })
  const timeout = setTimeout(() => { child.send({ type: 'cancel' }); child.kill() }, 20000)
  try {
    const code = await new Promise<number | null>((accept, reject) => { child.once('error', reject); child.once('exit', accept) })
    expect(code, output).toBe(0)
  } finally { clearTimeout(timeout); if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('close', resolve)) } }
}, 25000)
