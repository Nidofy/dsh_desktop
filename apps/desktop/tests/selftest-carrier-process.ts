/** Drain one test driver and its private Electron/Host subtree when the owning test ends. */
import { execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

/** Request the driver's production quit lifecycle before terminating a timed-out private process tree.
 * @param child - Caller-owned test driver with its private IPC channel.
 * @param done - Its already observed close result.
 * @returns Completion after the driver and remaining owned descendants exit.
 */
export async function closeSelftestCarrier(child: ChildProcess, done: Promise<object>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) { await done; return }
  if (child.connected) child.send({ type: 'cancel' }, () => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const exited = await Promise.race([done.then(() => true), new Promise<boolean>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, 5000)
  })])
  clearTimeout(timer)
  if (!exited && child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
        if (error && child.exitCode === null && child.signalCode === null) {
          reject(new Error('Carrier process-tree termination failed', { cause: error }))
        }
        else resolve()
      })
    })
  }
  await done
}
