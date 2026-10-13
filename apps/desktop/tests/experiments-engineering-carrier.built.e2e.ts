/** Actual Electron Main/preload and auxiliary engineering UI use only retained runtime and synthetic isolated data. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
it.runIf(process.platform === 'win32')('previews explicit resources, confirms one protected Agent task and reads retained evidence through the actual renderer', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/experiments-engineering-carrier.mjs', import.meta.url)),
    resolve('.build/dispatch/evidence/relay-26/renderer')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let output = ''
  child.stdout?.on('data', (bytes) => { output += String(bytes) }); child.stderr?.on('data', (bytes) => { output += String(bytes) })
  const timer = setTimeout(() => { child.send({ type: 'cancel' }); child.kill() }, 120000)
  try {
    const code = await new Promise<number | null>((accept, reject) => { child.once('error', reject); child.once('exit', accept) })
    expect(code, output).toBe(0)
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('close', resolve)) }
  }
}, 125000)
