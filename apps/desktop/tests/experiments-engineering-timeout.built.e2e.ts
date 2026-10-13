/** Physical engineering timeout qualification uses a real 180-second limit, one held local provider and the complete supported Host. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
it.runIf(process.platform === 'win32')('times out after the real three-minute budget and drains without another dispatch or action', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/experiments-full-profile.mjs', import.meta.url)),
    resolve('.build/dispatch/evidence/relay-25/timeout-profile'), 'engineering-timeout'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let output = ''
  child.stdout?.on('data', (bytes) => { output += String(bytes) }); child.stderr?.on('data', (bytes) => { output += String(bytes) })
  const timeout = setTimeout(() => { child.send({ type: 'cancel' }); child.kill() }, 225000)
  try {
    const code = await new Promise<number | null>((accept, reject) => { child.once('error', reject); child.once('exit', accept) })
    expect(code, output).toBe(0)
  } finally { clearTimeout(timeout); if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('close', resolve)) } }
}, 230000)
